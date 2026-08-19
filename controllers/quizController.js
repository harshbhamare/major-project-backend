const Quiz = require('../models/Quiz');
const Topic = require('../models/Topic');
const Module = require('../models/Module');
const { generateQuizQuestions } = require('../config/aiService');
const { studentCanAccessModule } = require('./moduleController');

// @desc Generate quiz from module topics using AI
// @route POST /api/quizzes/generate/:moduleId
const generateQuiz = async (req, res) => {
  try {
    const module = await Module.findById(req.params.moduleId).populate('topics');
    if (!module) return res.status(404).json({ message: 'Module not found' });

    const allQuestions = [];
    for (const topic of module.topics) {
      try {
        const questions = await generateQuizQuestions(topic.title, topic.summary, 2, req.user._id);
        questions.forEach(q => allQuestions.push({ ...q, topicId: topic._id }));
      } catch (err) {
        console.error(`Failed questions for "${topic.title}":`, err.message);
      }
    }

    if (allQuestions.length === 0) {
      return res.status(500).json({ message: 'AI failed to generate questions. Try again.' });
    }

    const quiz = await Quiz.create({
      title: `${module.title} — Quiz`,
      moduleId: module._id,
      questions: allQuestions,
      createdBy: req.user._id,
      status: 'draft',
    });

    res.status(201).json(quiz);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Create quiz manually
// @route POST /api/quizzes
const createQuiz = async (req, res) => {
  try {
    const { title, moduleId, questions, timeLimit } = req.body;
    const quiz = await Quiz.create({
      title,
      moduleId,
      questions: questions || [],
      createdBy: req.user._id,
      timeLimit: timeLimit || 30,
    });
    res.status(201).json(quiz);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Get quizzes for a module
// @route GET /api/quizzes/module/:moduleId
const getQuizzesByModule = async (req, res) => {
  try {
    // Students must have access to the module before seeing its quizzes
    if (req.user.role === 'student') {
      const allowed = await studentCanAccessModule(req.user._id, req.params.moduleId);
      if (!allowed) return res.status(403).json({ message: 'You do not have access to this module.' });
    }
    const quizzes = await Quiz.find({ moduleId: req.params.moduleId });
    res.json(quizzes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Get single quiz
// @route GET /api/quizzes/:id
const getQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate('moduleId', 'title');
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    // Students must have access to the parent module
    if (req.user.role === 'student') {
      const allowed = await studentCanAccessModule(req.user._id, quiz.moduleId?._id || quiz.moduleId);
      if (!allowed) return res.status(403).json({ message: 'You do not have access to this quiz.' });

      // Strip correct answers from student response
      const sanitized = quiz.toObject();
      sanitized.questions = sanitized.questions.map(({ correctAnswer, ...rest }) => rest);
      return res.json(sanitized);
    }

    res.json(quiz);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Update quiz
// @route PUT /api/quizzes/:id
const updateQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    const { title, questions, timeLimit, status } = req.body;
    if (title) quiz.title = title;
    if (questions) quiz.questions = questions;
    if (timeLimit) quiz.timeLimit = timeLimit;
    if (status) quiz.status = status;
    await quiz.save();
    res.json(quiz);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Publish/unpublish quiz
// @route PUT /api/quizzes/:id/publish
const publishQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    quiz.status = quiz.status === 'published' ? 'draft' : 'published';
    await quiz.save();
    res.json(quiz);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { generateQuiz, createQuiz, getQuizzesByModule, getQuiz, updateQuiz, publishQuiz };
