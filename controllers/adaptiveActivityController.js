/**
 * adaptiveActivityController.js
 *
 * Closed-loop adaptive workflow:
 *   learner state → adaptation plan → AI generation →
 *   activity stored → student attempts → outcome scored →
 *   mastery updated → research logged → next plan returned
 */

const AdaptiveActivity    = require('../models/AdaptiveActivity');
const LearningInteraction = require('../models/LearningInteraction');
const Topic               = require('../models/Topic');
const { getNextLearningAction }  = require('../services/adaptationService');
const { updateTopicMastery }     = require('../services/learnerModelService');
const {
  generateAdaptiveContent,
  generateAdaptiveAssessment,
  evaluateAdaptiveResponse,
} = require('../config/aiService');
const { sanitizeAssessmentForClient } = require('../validators/assessmentValidator');
const { awardGamification }           = require('../services/gamificationService');

// ── Helper: extract plain summary string from stored topic summary ─────────────
function extractPlainSummary(raw) {
  if (!raw) return '';
  if (typeof raw === 'string' && raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.summary || parsed.explanation || '';
    } catch (_) {}
  }
  return typeof raw === 'string' ? raw : '';
}

// ── Format-aware scoring function (delegates to evaluateAdaptiveResponse) ──────
async function scoreAnswer(format, studentAnswer, question) {
  const res = await evaluateAdaptiveResponse({ format, studentAnswer, question });
  return res.isCorrect;
}

// ── Build client-safe response (never expose correctAnswer or evaluationData) ───
function buildClientActivity(activity) {
  return {
    _id:           activity._id,
    hasGap:        activity.plan?.hasGap ?? true,
    isAdvancement: activity.plan?.isAdvancement ?? false,
    plan:          activity.plan,
    content:       activity.content,
    question:      sanitizeAssessmentForClient(activity.question),
  };
}

// ─── Generate adaptive activity ───────────────────────────────────────────────

// @desc  Plan → generate content+question → save → return (no correctAnswer)
// @route POST /api/adaptive/generate/:moduleId
const generateActivity = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const studentId = req.user._id;
    const requestedFormat = req.query.format || req.body?.format;
    const requestedTopicId = req.query.topicId || req.body?.topicId;
    const forceNew = req.query.forceNew === 'true' || req.body?.forceNew === true;
    const allowAdvance = req.query.allowAdvance === 'true' || req.body?.allowAdvance === true;

    // Step 1 — Check for an existing pending activity first
    // This prevents duplicate generation on page refresh / React re-renders
    if (!forceNew) {
      const query = {
        studentId,
        moduleId,
        status: 'pending',
      };
      if (requestedTopicId) {
        query.topicId = requestedTopicId;
      }
      if (requestedFormat) {
        query.assessmentFormat = requestedFormat;
      }
      const existing = await AdaptiveActivity.findOne(query).sort({ createdAt: -1 });

      if (existing && existing.question) {
        // Re-serve the existing pending activity — no new AI call needed
        return res.json(buildClientActivity(existing));
      }
    }

    // Fetch recent activity format history for anti-fatigue format rotation
    const recentActivities = await AdaptiveActivity.find({
      studentId,
      moduleId,
      status: 'completed',
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('assessmentFormat');
    const recentFormats = recentActivities.map(a => a.assessmentFormat).filter(Boolean);

    // Step 2 — Get adaptation plan (passing autoStart: true so practice begins automatically)
    let plan = await getNextLearningAction(studentId, moduleId, {
      allowAdvance,
      targetTopicId: requestedTopicId,
      format: requestedFormat,
      recentFormats,
      autoStart: true,
    });

    if (!plan || !plan.hasGap) {
      // Direct automated practice fallback on module topics
      const Module = require('../models/Module');
      const moduleDoc = await Module.findById(moduleId).populate('topics', 'title summary difficulty');
      let topic = null;
      if (requestedTopicId && moduleDoc?.topics) {
        topic = moduleDoc.topics.find(t => t._id.toString() === requestedTopicId.toString());
      }
      if (!topic) {
        topic = moduleDoc?.topics?.[0];
      }
      if (topic) {
        const { determineAutomatedFormat } = require('../services/adaptationService');
        const automated = determineAutomatedFormat({
          module: moduleDoc,
          topic,
          mastery: 0.5,
          trend: 'stable',
          recentFormats,
          isAdvancement: false,
        });
        const effFormat = requestedFormat || automated.format;
        const bloomLevel = (effFormat === 'debugging' || effFormat === 'scenario_based') ? 'analyze'
          : (effFormat === 'code_completion' || effFormat === 'code_tracing') ? 'apply'
          : 'understand';
        plan = {
          hasGap: true,
          action: 'practice',
          topicId: topic._id,
          topicTitle: topic.title,
          currentMastery: 0.5,
          targetMastery: 0.8,
          difficulty: topic.difficulty || moduleDoc.difficulty || 'normal',
          bloomLevel,
          contentStrategy: 'worked_example',
          assessmentFormat: effFormat,
          learningObjective: `Practice and master ${topic.title} through automated ${effFormat.replace('_', ' ')} exercises`,
          reason: requestedFormat ? `Direct practice on ${topic.title} (${effFormat.replace('_', ' ')})` : automated.reason,
        };
      }
    }

    if (!plan || !plan.hasGap) {
      return res.json({
        hasGap:         false,
        action:         plan?.action         || 'no_action',
        noActionReason: plan?.noActionReason || 'no_topics',
        reason:         plan?.reason         || 'No topics available for adaptive practice in this module.',
        canAdvance:     plan?.canAdvance     || false,
      });
    }

    if (requestedFormat) {
      plan.assessmentFormat = requestedFormat;
      if (requestedFormat === 'debugging' && plan.bloomLevel !== 'analyze' && plan.bloomLevel !== 'evaluate') {
        plan.bloomLevel = 'analyze';
      }
    }

    // Step 3 — Fetch topic for context
    const topic = await Topic.findById(plan.topicId).select('summary title');
    const topicSummaryPlain = extractPlainSummary(topic?.summary || '');

    // Step 4 — Generate adaptive content (explanation / example)
    let contentResult = null;
    try {
      contentResult = await generateAdaptiveContent(plan, topicSummaryPlain, studentId);
    } catch (err) {
      console.error('generateAdaptiveContent failed (non-fatal):', err.message);
    }

    // Step 5 — Generate adaptive assessment question
    const assessmentSpec = {
      topic:             plan.topicTitle,
      topicSummary:      topicSummaryPlain,
      learningObjective: plan.learningObjective,
      bloomLevel:        plan.bloomLevel,
      difficulty:        plan.difficulty,
      assessmentFormat:  plan.assessmentFormat,
      contentStrategy:   plan.contentStrategy,
      mastery:           plan.mastery,
      trend:             plan.trend,
    };

    let question = null;
    try {
      question = await generateAdaptiveAssessment(assessmentSpec, studentId);
    } catch (err) {
      console.error('generateAdaptiveAssessment failed:', err.message);
    }

    // Step 6 — If question generation failed, return content-only
    if (!question) {
      const contentOnlyActivity = await AdaptiveActivity.create({
        studentId,
        moduleId,
        topicId:  plan.topicId,
        plan,
        content:  contentResult,
        question: null,
        status:   'pending',
      });

      return res.status(201).json({
        _id:            contentOnlyActivity._id,
        hasGap:         true,
        plan,
        content:        contentResult,
        question:       null,
        noQuestion:     true,
        noQuestionReason: 'Question generation currently unavailable. You can still review the learning material above.',
      });
    }

    // Step 7 — Save full activity (question.correctAnswer stored server-side only)
    const activity = await AdaptiveActivity.create({
      studentId,
      moduleId,
      topicId:           plan.topicId,
      plan,
      content:           contentResult,
      assessmentFormat:  question.assessmentFormat,
      difficulty:        question.difficulty,
      bloomLevel:        question.bloomLevel,
      learningObjective: question.learningObjective,
      question: {
        questionText:      question.questionText,
        options:           question.options,
        correctAnswer:     question.correctAnswer,
        marks:             question.marks,
        difficulty:        question.difficulty,
        bloomLevel:        question.bloomLevel,
        assessmentFormat:  question.assessmentFormat,
        learningObjective: question.learningObjective,
        explanation:       question.explanation,
        payload:           question.payload || {},
        evaluationData:    question.evaluationData || {},
      },
      status: 'pending',
    });

    res.status(201).json(buildClientActivity(activity));

  } catch (err) {
    console.error('generateActivity error:', err.message);
    res.status(500).json({ message: 'Failed to generate adaptive activity: ' + err.message });
  }
};

// ─── Get specific adaptive activity ──────────────────────────────────────────

// @desc  Get adaptive activity by ID (student ownership verified)
// @route GET /api/adaptive/activity/:activityId
const getActivity = async (req, res) => {
  try {
    const { activityId } = req.params;
    const studentId = req.user._id;

    const activity = await AdaptiveActivity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ message: 'Adaptive activity not found.' });
    }
    if (activity.studentId.toString() !== studentId.toString()) {
      return res.status(403).json({ message: 'Not authorised.' });
    }

    if (activity.status === 'completed') {
      // Completed activity: include full outcome & research traceability
      return res.json({
        _id:                activity._id,
        status:             activity.status,
        plan:               activity.plan,
        content:            activity.content,
        question:           activity.question,
        studentAnswer:      activity.studentAnswer,
        isCorrect:          activity.isCorrect,
        score:              activity.score,
        masteryBefore:      activity.masteryBefore,
        masteryAfter:       activity.masteryAfter,
        submissionMetadata: activity.submissionMetadata,
        submittedAt:        activity.submittedAt,
      });
    }

    // Pending activity: withhold correctAnswer
    res.json(buildClientActivity(activity));
  } catch (err) {
    console.error('getActivity error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── Get next activity / plan ────────────────────────────────────────────────

// @desc  Get existing pending activity or the current adaptation plan for module
// @route GET /api/adaptive/next/:moduleId
const getNextActivity = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const studentId = req.user._id;
    const allowAdvance = req.query.allowAdvance === 'true';

    const existing = await AdaptiveActivity.findOne({
      studentId,
      moduleId,
      status: 'pending',
    }).sort({ createdAt: -1 });

    if (existing && existing.question) {
      return res.json(buildClientActivity(existing));
    }

    const plan = await getNextLearningAction(studentId, moduleId, { allowAdvance });
    res.json(plan || { hasGap: false, action: 'no_action', reason: 'No data available yet.' });
  } catch (err) {
    console.error('getNextActivity error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── Submit adaptive activity answer ─────────────────────────────────────────

// @desc  Score → update mastery → log → return feedback + next plan
// @route POST /api/adaptive/submit/:activityId
const submitActivity = async (req, res) => {
  try {
    const { activityId } = req.params;
    const { answer }     = req.body;
    const studentId      = req.user._id;

    if (!answer || answer.toString().trim() === '') {
      return res.status(400).json({ message: 'An answer is required.' });
    }

    const activity = await AdaptiveActivity.findById(activityId);
    if (!activity)
      return res.status(404).json({ message: 'Adaptive activity not found.' });
    if (activity.studentId.toString() !== studentId.toString())
      return res.status(403).json({ message: 'Not authorised.' });
    if (activity.status === 'completed')
      return res.status(400).json({ message: 'This activity has already been submitted.' });
    if (!activity.question)
      return res.status(400).json({ message: 'This activity has no question to submit.' });

    const q      = activity.question;
    const format = q.assessmentFormat || 'mcq';

    // ── Score using defensible format-aware evaluator (Spec §13) ──────────────
    const evalResult = await evaluateAdaptiveResponse({
      format,
      studentAnswer: answer,
      question: q,
      userId: studentId,
    });
    const isCorrect = Boolean(evalResult.isCorrect);
    const normalizedScore = typeof evalResult.score === 'number' ? evalResult.score : (isCorrect ? 1 : 0);

    // ── Update persistent per-topic learner state (EMA) ───────────────────────
    const masteryUpdate = await updateTopicMastery(
      studentId,
      activity.topicId,
      normalizedScore,
      q.difficulty || 'normal'
    ).catch(err => {
      console.error('Mastery update error (non-fatal):', err.message);
      return null;
    });

    // ── Log LearningInteraction event (isAdaptive=true, Spec §16) ─────────────
    await LearningInteraction.create({
      studentId,
      moduleId:           activity.moduleId,
      topicId:            activity.topicId,
      adaptiveActivityId: activity._id,
      activityType:       'adaptive_quiz',
      isAdaptive:         true,
      assessmentFormat:   format,
      difficulty:         q.difficulty || 'normal',
      bloomLevel:         q.bloomLevel || 'apply',
      learningObjective:  q.learningObjective || activity.plan?.learningObjective || '',
      score:              normalizedScore,
      isCorrect,
      attemptNumber:      masteryUpdate?.record?.attemptCount ?? 1,
      masteryBefore:      masteryUpdate?.before ?? null,
      masteryAfter:       masteryUpdate?.after  ?? null,
      selectedStrategy:   activity.plan?.action || 'remediate',
      timestamp:          new Date(),
    }).catch(err => console.error('LI adaptive log error (non-fatal):', err.message));

    // ── Mark activity completed & persist research metadata ──────────────────
    const modelSolution = q.evaluationData?.modelAnswer ||
      q.evaluationData?.correctCompletion ||
      q.evaluationData?.identifiedBug ||
      q.evaluationData?.expectedOutput ||
      q.evaluationData?.bestChoice ||
      q.correctAnswer || '';

    activity.status             = 'completed';
    activity.studentAnswer      = typeof answer === 'object' ? JSON.stringify(answer) : answer.toString();
    activity.isCorrect          = isCorrect;
    activity.score              = normalizedScore;
    activity.masteryBefore      = masteryUpdate?.before ?? null;
    activity.masteryAfter       = masteryUpdate?.after  ?? null;
    activity.submissionMetadata = {
      evaluator:       evalResult.evaluator,
      feedback:        evalResult.feedback,
      criteriaResults: evalResult.criteriaResults || [],
      submittedAt:     new Date(),
    };
    activity.submittedAt        = new Date();
    await activity.save();

    // ── Compute next adaptation plan from updated learner state ───────────────
    const nextPlan = await getNextLearningAction(studentId, activity.moduleId, { allowAdvance: true })
      .catch(() => null);

    // ── Award Gamification (XP, Streak, Level, Badges) ────────────────────────
    const gamification = await awardGamification(studentId, {
      type: 'adaptive',
      format,
      isCorrect,
      score: normalizedScore,
    }).catch(err => {
      console.error('Gamification error (non-fatal):', err.message);
      return null;
    });

    const isObjective = ['mcq', 'scenario_based'].includes(format) && Array.isArray(q.payload?.options || q.options) && (q.payload?.options || q.options).length >= 2;

    res.json({
      isCorrect,
      normalizedScore,
      evaluator:       evalResult.evaluator,
      evalFeedback:    evalResult.feedback,
      criteriaResults: evalResult.criteriaResults || [],
      correctAnswer:   q.evaluationData?.correctAnswer || q.correctAnswer || '',
      explanation:     q.explanation || '',
      masteryBefore:   masteryUpdate?.before ?? null,
      masteryAfter:    masteryUpdate?.after  ?? null,
      // For open-ended, code, or non-choice formats show model answer
      modelAnswer:     !isObjective ? modelSolution : null,
      nextPlan,
      gamification,
    });

  } catch (err) {
    console.error('submitActivity error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── History ──────────────────────────────────────────────────────────────────

// @route GET /api/adaptive/history/:moduleId
const getActivityHistory = async (req, res) => {
  try {
    const activities = await AdaptiveActivity.find({
      studentId: req.user._id,
      moduleId:  req.params.moduleId,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('-question.correctAnswer -question.evaluationData');

    res.json(activities);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  generateActivity,
  getActivity,
  getNextActivity,
  submitActivity,
  getActivityHistory,
};
