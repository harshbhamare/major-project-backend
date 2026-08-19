const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  generateQuiz, createQuiz, getQuizzesByModule,
  getQuiz, updateQuiz, publishQuiz,
} = require('../controllers/quizController');

router.use(protect);

// ── Specific routes MUST come before param routes ──────────────────────────
router.get('/module/:moduleId', getQuizzesByModule);

router.post('/generate/:moduleId', authorize('faculty', 'admin'), generateQuiz);

// ── Param routes ───────────────────────────────────────────────────────────
router.get('/:id', getQuiz);
router.post('/', authorize('faculty', 'admin'), createQuiz);
router.put('/:id', authorize('faculty', 'admin'), updateQuiz);
router.put('/:id/publish', authorize('faculty', 'admin'), publishQuiz);

module.exports = router;
