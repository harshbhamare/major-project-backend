const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  submitQuiz, getMyResults, getStudentDashboard,
  getModuleResults, getAnalytics,
} = require('../controllers/resultController');

router.use(protect);
router.post('/submit', authorize('student'), submitQuiz);
router.get('/my', authorize('student'), getMyResults);
router.get('/dashboard', authorize('student'), getStudentDashboard);
router.get('/module/:moduleId', authorize('faculty', 'admin'), getModuleResults);
router.get('/analytics', authorize('admin'), getAnalytics);

module.exports = router;
