const Result              = require('../models/Result');
const Quiz                = require('../models/Quiz');
const Module              = require('../models/Module');
const Topic               = require('../models/Topic');
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

    let attemptedCount = 0;
    let skippedCount = 0;
    let correctCount = 0;

    const processedAnswers = quiz.questions.map((q) => {
      const studentAnswer = answers.find(a => a.questionId === q._id.toString());
      const selected = (studentAnswer?.selectedAnswer ?? '').toString().trim();
      const isAttempted = selected.length > 0;
      if (isAttempted) attemptedCount++;
      else skippedCount++;

      const isCorrect = isAttempted && selected === (q.correctAnswer ?? '').toString().trim();
      totalMarks += q.marks;
      if (isCorrect) {
        score += q.marks;
        correctCount++;
      } else if (q.topicId) {
        weakTopicIds.add(q.topicId.toString());
      }
      return {
        questionId:     q._id,
        selectedAnswer: selected,
        isCorrect,
        correctAnswer:  q.correctAnswer,
        explanation:    q.explanation || '',
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
      stats: {
        totalQuestions: quiz.questions.length,
        attempted: attemptedCount,
        skipped: skippedCount,
        correct: correctCount,
        incorrect: Math.max(0, attemptedCount - correctCount),
      },
      feedback: {
        percentage,
        recommendedDifficulty,
        message:
          percentage === 0
            ? 'Score: 0%. Most or all questions were skipped. Please review the material and retry.'
            : percentage < 40
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

// ─── Helper: Compute comprehensive class & student analytics ──────────────────
const computeResultsAnalytics = (results) => {
  const totalStudents = new Set(results.map(r => r.studentId?._id?.toString()).filter(Boolean)).size;
  const avgScore = results.length
    ? Math.round(results.reduce((s, r) => s + (r.percentage || 0), 0) / results.length)
    : 0;

  // Score Distribution Buckets
  const distribution = [
    { range: '0-40%', label: 'Critical (<40%)', count: 0, color: '#ef4444' },
    { range: '41-60%', label: 'Needs Help (41-60%)', count: 0, color: '#f59e0b' },
    { range: '61-80%', label: 'Proficient (61-80%)', count: 0, color: '#3b82f6' },
    { range: '81-100%', label: 'Mastered (81-100%)', count: 0, color: '#10b981' },
  ];

  results.forEach(r => {
    const p = r.percentage || 0;
    if (p <= 40) distribution[0].count++;
    else if (p <= 60) distribution[1].count++;
    else if (p <= 80) distribution[2].count++;
    else distribution[3].count++;
  });

  // Group by Student for Comprehensive Student Status Profiles
  const studentMap = new Map();
  results.forEach(r => {
    if (!r.studentId?._id) return;
    const sId = r.studentId._id.toString();
    if (!studentMap.has(sId)) {
      studentMap.set(sId, {
        student: r.studentId,
        attempts: [],
        weakTopicsMap: new Map(),
      });
    }
    const entry = studentMap.get(sId);
    entry.attempts.push({
      _id: r._id,
      quizTitle: r.quizId?.title || 'Quiz',
      moduleTitle: r.moduleId?.title || 'Module',
      score: r.score,
      totalMarks: r.totalMarks,
      percentage: r.percentage,
      recommendedDifficulty: r.recommendedDifficulty,
      date: r.createdAt,
    });

    (r.weakTopics || []).forEach(wt => {
      if (!wt?._id) return;
      const wtId = wt._id.toString();
      if (!entry.weakTopicsMap.has(wtId)) {
        entry.weakTopicsMap.set(wtId, { title: wt.title, count: 0 });
      }
      entry.weakTopicsMap.get(wtId).count++;
    });
  });

  const students = Array.from(studentMap.values()).map(item => {
    const sortedAttempts = item.attempts.sort((a, b) => new Date(a.date) - new Date(b.date));
    const percentages = sortedAttempts.map(a => a.percentage);
    const latestScore = percentages[percentages.length - 1] || 0;
    const highestScore = Math.max(...percentages);
    const avg = Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);

    let trend = 'stable';
    if (percentages.length >= 2) {
      const diff = percentages[percentages.length - 1] - percentages[0];
      if (diff > 5) trend = 'improving';
      else if (diff < -5) trend = 'declining';
    }

    let status = 'mastered';
    if (avg < 60 || latestScore < 50) status = 'needs_intervention';
    else if (avg < 80) status = 'developing';

    return {
      student: item.student,
      totalAttempts: item.attempts.length,
      latestScore,
      highestScore,
      averageScore: avg,
      trend,
      status,
      weakTopics: Array.from(item.weakTopicsMap.values()),
      recentAttempts: sortedAttempts.slice(-5).reverse(),
      lastActive: sortedAttempts[sortedAttempts.length - 1]?.date,
    };
  });

  // Sort students by status severity (needs_intervention first) then lowest avgScore
  students.sort((a, b) => {
    const order = { needs_intervention: 0, developing: 1, mastered: 2 };
    if (order[a.status] !== order[b.status]) {
      return order[a.status] - order[b.status];
    }
    return a.averageScore - b.averageScore;
  });

  // Frequency of Weak Topics across Class
  const classWeakTopicsMap = new Map();
  results.forEach(r => {
    (r.weakTopics || []).forEach(wt => {
      if (!wt?._id) return;
      const id = wt._id.toString();
      if (!classWeakTopicsMap.has(id)) {
        classWeakTopicsMap.set(id, { topicId: id, title: wt.title, count: 0 });
      }
      classWeakTopicsMap.get(id).count++;
    });
  });

  const weakTopicsRanking = Array.from(classWeakTopicsMap.values())
    .sort((a, b) => b.count - a.count);

  // Timeline Data for Trend Visualization
  const timelineData = results
    .slice(0, 30)
    .reverse()
    .map(r => ({
      date: new Date(r.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      score: r.percentage,
      student: r.studentId?.name || 'Student',
    }));

  return {
    results,
    totalStudents,
    avgScore,
    distribution,
    students,
    weakTopicsRanking,
    timelineData,
    atRiskCount: students.filter(s => s.status === 'needs_intervention').length,
    masteredCount: students.filter(s => s.status === 'mastered').length,
  };
};

// @desc  Faculty: get results for a specific module with student profiles & diagnostics
// @route GET /api/results/module/:moduleId
const getModuleResults = async (req, res) => {
  try {
    const results = await Result.find({ moduleId: req.params.moduleId })
      .populate('studentId', 'name email xp level streak')
      .populate('quizId', 'title')
      .populate('moduleId', 'title')
      .populate('weakTopics', 'title')
      .sort({ createdAt: -1 });

    const analytics = computeResultsAnalytics(results);
    res.json(analytics);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Faculty: get overall aggregated performance across all own modules
// @route GET /api/results/faculty-overview
const getFacultyOverview = async (req, res) => {
  try {
    const Module = require('../models/Module');
    // Find modules created by faculty; if none, fallback to all published modules so faculty can still view analytics
    let myModules = await Module.find({ createdBy: req.user._id }).select('_id title difficulty status topics');
    if (!myModules || myModules.length === 0) {
      myModules = await Module.find().select('_id title difficulty status topics');
    }
    const moduleIds = myModules.map(m => m._id);

    const allResults = await Result.find({ moduleId: { $in: moduleIds } })
      .populate('studentId', 'name email xp level streak')
      .populate('quizId', 'title')
      .populate('moduleId', 'title')
      .populate('weakTopics', 'title')
      .sort({ createdAt: -1 });

    const analytics = computeResultsAnalytics(allResults);

    res.json({
      ...analytics,
      totalModules: myModules.length,
      totalSubmissions: allResults.length,
      modules: myModules,
    });
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

module.exports = {
  submitQuiz,
  getMyResults,
  getStudentDashboard,
  getModuleResults,
  getFacultyOverview,
  getAnalytics,
};
