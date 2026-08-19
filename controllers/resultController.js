const Result = require('../models/Result');
const Quiz = require('../models/Quiz');

// Adaptive logic: determine difficulty based on score percentage
const getRecommendedDifficulty = (percentage) => {
  if (percentage < 40) return 'easy';
  if (percentage <= 70) return 'normal';
  return 'advanced';
};

// @desc Submit quiz answers
// @route POST /api/results/submit
const submitQuiz = async (req, res) => {
  const { quizId, answers, timeTaken } = req.body;

  const quiz = await Quiz.findById(quizId).populate('moduleId');
  if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

  let score = 0;
  let totalMarks = 0;
  const weakTopicIds = new Set();

  const processedAnswers = quiz.questions.map((question) => {
    const studentAnswer = answers.find(
      (a) => a.questionId === question._id.toString()
    );
    const isCorrect = studentAnswer?.selectedAnswer === question.correctAnswer;
    totalMarks += question.marks;
    if (isCorrect) {
      score += question.marks;
    } else if (question.topicId) {
      weakTopicIds.add(question.topicId.toString());
    }
    return {
      questionId: question._id,
      selectedAnswer: studentAnswer?.selectedAnswer || '',
      isCorrect,
      topicId: question.topicId,
    };
  });

  const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
  const recommendedDifficulty = getRecommendedDifficulty(percentage);

  const result = await Result.create({
    studentId: req.user._id,
    quizId,
    moduleId: quiz.moduleId?._id,
    answers: processedAnswers,
    score,
    totalMarks,
    percentage,
    timeTaken,
    weakTopics: Array.from(weakTopicIds),
    recommendedDifficulty,
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
          ? 'Good effort! Keep practicing at the current level.'
          : 'Excellent! You are ready for advanced content.',
    },
  });
};

// @desc Get student's own results
// @route GET /api/results/my
const getMyResults = async (req, res) => {
  const results = await Result.find({ studentId: req.user._id })
    .populate('quizId', 'title')
    .populate('moduleId', 'title')
    .populate('weakTopics', 'title')
    .sort({ createdAt: -1 });
  res.json(results);
};

// @desc Get student dashboard stats
// @route GET /api/results/dashboard
const getStudentDashboard = async (req, res) => {
  const results = await Result.find({ studentId: req.user._id })
    .populate('weakTopics', 'title')
    .populate('moduleId', 'title');

  const totalQuizzes = results.length;
  const avgScore = totalQuizzes
    ? Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / totalQuizzes)
    : 0;

  // Aggregate weak topics
  const weakTopicMap = {};
  results.forEach((r) => {
    r.weakTopics.forEach((t) => {
      if (t && t._id) {
        weakTopicMap[t._id] = t.title;
      }
    });
  });

  const latestResult = results[0];
  const recommendedDifficulty = latestResult?.recommendedDifficulty || 'normal';

  res.json({
    totalQuizzes,
    avgScore,
    weakTopics: Object.values(weakTopicMap),
    recommendedDifficulty,
    recentResults: results.slice(0, 5),
  });
};

// @desc Faculty: get results for a module
// @route GET /api/results/module/:moduleId
const getModuleResults = async (req, res) => {
  const results = await Result.find({ moduleId: req.params.moduleId })
    .populate('studentId', 'name email')
    .populate('quizId', 'title')
    .sort({ createdAt: -1 });

  const totalStudents = new Set(results.map((r) => r.studentId?._id?.toString())).size;
  const avgScore = results.length
    ? Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / results.length)
    : 0;

  res.json({ results, totalStudents, avgScore });
};

// @desc Admin: get all results summary
// @route GET /api/results/analytics
const getAnalytics = async (req, res) => {
  const totalResults = await Result.countDocuments();
  const avgScore = await Result.aggregate([
    { $group: { _id: null, avg: { $avg: '$percentage' } } },
  ]);

  const difficultyBreakdown = await Result.aggregate([
    { $group: { _id: '$recommendedDifficulty', count: { $sum: 1 } } },
  ]);

  res.json({
    totalResults,
    avgScore: avgScore[0]?.avg ? Math.round(avgScore[0].avg) : 0,
    difficultyBreakdown,
  });
};

module.exports = { submitQuiz, getMyResults, getStudentDashboard, getModuleResults, getAnalytics };
