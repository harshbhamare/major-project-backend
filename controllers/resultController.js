const Result              = require('../models/Result');
const Quiz                = require('../models/Quiz');
const LearnerKnowledge    = require('../models/LearnerKnowledge');
const LearningInteraction = require('../models/LearningInteraction');
const User                = require('../models/User');
const { updateMasteryFromAnswers, getAttemptCount } = require('../services/learnerModelService');
const { getNextLearningAction }    = require('../services/adaptationService');
const { awardGamification, getLevelInfo } = require('../services/gamificationService');

// ─── Legacy helper — kept for backward compatibility ──────────────────────────
const getRecommendedDifficulty = (pct) =>
  pct < 40 ? 'easy' : pct <= 70 ? 'normal' : 'advanced';

// ─── Submit quiz ──────────────────────────────────────────────────────────────

// @desc  Submit quiz answers, update learner model, return adaptation plan
// @route POST /api/results/submit
const submitQuiz = async (req, res) => {
  try {
    const { quizId, answers, timeTaken } = req.body;

    const quiz = await Quiz.findById(quizId).populate('moduleId');
    if (!quiz) return res.status(404).json({ message: 'Quiz not found.' });

    // ── Step 1: Score the submission ─────────────────────────────────────────
    let score = 0, totalMarks = 0;
    const weakTopicIds = new Set();

    const processedAnswers = quiz.questions.map((q) => {
      const studentAnswer = answers.find(a => a.questionId === q._id.toString());
      const isCorrect = studentAnswer?.selectedAnswer === q.correctAnswer;
      totalMarks += q.marks;
      if (isCorrect) {
        score += q.marks;
      } else if (q.topicId) {
        weakTopicIds.add(q.topicId.toString());
      }
      return {
        questionId:     q._id,
        selectedAnswer: studentAnswer?.selectedAnswer || '',
        isCorrect,
        topicId:        q.topicId,
        difficulty:     q.difficulty || 'normal',
      };
    });

    const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
    const recommendedDifficulty = getRecommendedDifficulty(percentage);

    // ── Step 2: Persist Result (unchanged schema) ────────────────────────────
    const result = await Result.create({
      studentId:  req.user._id,
      quizId,
      moduleId:   quiz.moduleId?._id,
      answers:    processedAnswers,
      score,
      totalMarks,
      percentage,
      timeTaken,
      weakTopics:             Array.from(weakTopicIds),
      recommendedDifficulty,
    });

    // ── Step 3: Update per-topic mastery (spec §8) ───────────────────────────
    // Fire-and-forget — don't let mastery update failures block the response
    const masteryUpdates = await updateMasteryFromAnswers(
      req.user._id,
      processedAnswers
    ).catch(err => {
      console.error('Mastery update error (non-fatal):', err.message);
      return {};
    });

    // ── Step 4: Log LearningInteraction events (spec §18) ───────────────────
    // Each interaction gets its own attemptNumber and learningObjective
    // from the question schema. isAdaptive=false for standard quiz attempts.
    const interactionDocs = await Promise.all(
      processedAnswers
        .filter(a => a.topicId)
        .map(async (a) => {
          const topicKey = a.topicId.toString();
          const masteryData = masteryUpdates[topicKey] || {};
          // attemptNumber = count AFTER this update (already incremented in updateMasteryFromAnswers)
          const attemptNumber = masteryData.record?.attemptCount ?? 1;
          // Pull learningObjective from the question if available
          const questionObj = quiz.questions.find(q => q._id.toString() === a.questionId.toString());
          const learningObjective = questionObj?.learningObjective || '';
          const bloomLevel = questionObj?.bloomLevel || undefined;
          const assessmentFormat = questionObj?.assessmentFormat || 'mcq';

          return {
            studentId:        req.user._id,
            moduleId:         quiz.moduleId?._id,
            topicId:          a.topicId,
            resultId:         result._id,
            activityType:     'quiz_attempt',
            isAdaptive:       false,          // standard quiz — never adaptive
            assessmentFormat,
            difficulty:       a.difficulty,
            bloomLevel,
            learningObjective,
            score:            a.isCorrect ? 1 : 0,
            isCorrect:        a.isCorrect,
            attemptNumber,
            masteryBefore:    masteryData.before ?? null,
            masteryAfter:     masteryData.after  ?? null,
            selectedStrategy: 'standard',     // no adaptive decision made
            timestamp:        new Date(),
          };
        })
    );

    if (interactionDocs.length > 0) {
      LearningInteraction.insertMany(interactionDocs).catch(err =>
        console.error('LearningInteraction log error (non-fatal):', err.message)
      );
    }

    // ── Step 5: Get adaptation recommendation (spec §19, §20) ───────────────
    const moduleId = quiz.moduleId?._id;
    const adaptationPlan = moduleId
      ? await getNextLearningAction(req.user._id, moduleId).catch(() => null)
      : null;

    // ── Step 6: Respond ──────────────────────────────────────────────────────
    // ── Step 7: Award Gamification (XP, Streak, Level, Badges) ──────────────
    const gamification = await awardGamification(req.user._id, {
      type: 'quiz',
      percentage,
      score,
    }).catch(err => {
      console.error('Quiz gamification error (non-fatal):', err.message);
      return null;
    });

    res.status(201).json({
      result,
      feedback: {
        percentage,
        recommendedDifficulty,
        message:
          percentage < 40
            ? 'Review the basics — easier content has been recommended.'
            : percentage <= 70
            ? 'Good effort! Keep practising at the current level.'
            : 'Excellent! You are ready for advanced content.',
      },
      // Adaptation plan — null if no gaps found or insufficient data
      adaptation: adaptationPlan,
      gamification,
    });
  } catch (err) {
    console.error('submitQuiz error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── Student results ──────────────────────────────────────────────────────────

// @desc  Get student's own results
// @route GET /api/results/my
const getMyResults = async (req, res) => {
  try {
    const results = await Result.find({ studentId: req.user._id })
      .populate('quizId', 'title')
      .populate('moduleId', 'title')
      .populate('weakTopics', 'title')
      .sort({ createdAt: -1 });
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Student dashboard stats + per-topic mastery summary
// @route GET /api/results/dashboard
const getStudentDashboard = async (req, res) => {
  try {
    const results = await Result.find({ studentId: req.user._id })
      .populate('weakTopics', 'title')
      .populate('moduleId', 'title')
      .sort({ createdAt: -1 });

    const totalQuizzes = results.length;
    const avgScore = totalQuizzes
      ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / totalQuizzes)
      : 0;

    // Deduplicated weak topics across all attempts
    const weakTopicMap = {};
    results.forEach(r => r.weakTopics.forEach(t => {
      if (t?._id) weakTopicMap[t._id] = t.title;
    }));

    // Mastery records for all assessed topics
    const masteryRecords = await LearnerKnowledge.find({ studentId: req.user._id })
      .populate('topicId', 'title difficulty')
      .sort({ mastery: 1 })
      .limit(20);

    const topicMastery = masteryRecords.map(r => ({
      topicId:   r.topicId?._id,
      topicTitle: r.topicId?.title || 'Unknown',
      mastery:   Math.round(r.mastery * 100) / 100,
      state:     LearnerKnowledge.classify(r.mastery),
      trend:     r.trend,
      attempts:  r.attemptCount,
    }));

    const latestResult = results[0];

    const user = await User.findById(req.user._id).select('xp level streak badges lastActiveDate');
    const levelInfo = getLevelInfo(user?.xp || 0);
    const gamification = {
      xp: user?.xp || 0,
      level: levelInfo.level,
      levelTitle: levelInfo.title,
      nextLevelXp: levelInfo.nextLevelXp,
      currentBaseXp: levelInfo.currentBaseXp,
      progressPct: levelInfo.progressPct,
      streak: user?.streak || 1,
      badges: user?.badges || [],
    };

    res.json({
      totalQuizzes,
      avgScore,
      weakTopics:           Object.values(weakTopicMap),
      recommendedDifficulty: latestResult?.recommendedDifficulty || 'normal',
      recentResults:        results.slice(0, 5),
      topicMastery,         // per-topic knowledge state
      gamification,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Faculty ──────────────────────────────────────────────────────────────────

// @desc  Faculty: get results for a module
// @route GET /api/results/module/:moduleId
const getModuleResults = async (req, res) => {
  try {
    const results = await Result.find({ moduleId: req.params.moduleId })
      .populate('studentId', 'name email')
      .populate('quizId', 'title')
      .sort({ createdAt: -1 });

    const totalStudents = new Set(results.map(r => r.studentId?._id?.toString())).size;
    const avgScore = results.length
      ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length)
      : 0;

    res.json({ results, totalStudents, avgScore });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Admin ─────────────────────────────────────────────────────────────────────

// @desc  Admin: get all results summary
// @route GET /api/results/analytics
const getAnalytics = async (req, res) => {
  try {
    const totalResults = await Result.countDocuments();
    const avgScoreAgg  = await Result.aggregate([
      { $group: { _id: null, avg: { $avg: '$percentage' } } },
    ]);
    const difficultyBreakdown = await Result.aggregate([
      { $group: { _id: '$recommendedDifficulty', count: { $sum: 1 } } },
    ]);

    // Mastery distribution
    const masteryDistribution = await LearnerKnowledge.aggregate([
      {
        $bucket: {
          groupBy: '$mastery',
          boundaries: [0, 0.4, 0.6, 0.8, 1.01],
          default: 'other',
          output: { count: { $sum: 1 } },
        },
      },
    ]);

    res.json({
      totalResults,
      avgScore:       avgScoreAgg[0]?.avg ? Math.round(avgScoreAgg[0].avg) : 0,
      difficultyBreakdown,
      masteryDistribution,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { submitQuiz, getMyResults, getStudentDashboard, getModuleResults, getAnalytics };
