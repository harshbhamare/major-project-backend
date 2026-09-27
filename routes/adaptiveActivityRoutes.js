const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  generateActivity,
  getActivity,
  getNextActivity,
  submitActivity,
  getActivityHistory,
} = require('../controllers/adaptiveActivityController');

router.use(protect, authorize('student'));

// Generate a new adaptive activity for the highest-priority gap in a module
router.post('/generate/:moduleId', generateActivity);

// Get current pending activity or next adaptation plan
router.get('/next/:moduleId', getNextActivity);

// Get specific adaptive activity by ID (student ownership verified)
router.get('/activity/:activityId', getActivity);

// Submit an answer for a generated adaptive activity
router.post('/submit/:activityId', submitActivity);

// Get adaptive activity history for a student in a module
router.get('/history/:moduleId', getActivityHistory);

module.exports = router;
