const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { getUsers, createUser, updateUser, deleteUser, getSystemAnalytics, getApiUsageStats } = require('../controllers/adminController');

router.use(protect, authorize('admin'));
router.get('/users', getUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/analytics', getSystemAnalytics);
router.get('/api-usage', getApiUsageStats);

module.exports = router;
