const User = require('../models/User');
const Content = require('../models/Content');
const Module = require('../models/Module');
const Quiz = require('../models/Quiz');
const Result = require('../models/Result');
const ApiUsage = require('../models/ApiUsage');
const Room = require('../models/Room');
const { DAILY_LIMIT } = require('../config/aiService');

// @desc Get all users
// @route GET /api/admin/users
const getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Create user (admin only)
// @route POST /api/admin/users
const createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: 'Name, email and password are required.' });
    }
    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) return res.status(400).json({ message: 'User already exists.' });
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: ['student', 'faculty', 'admin'].includes(role) ? role : 'student',
    });
    res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Update user
// @route PUT /api/admin/users/:id
const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Prevent admin from accidentally deactivating themselves
    if (req.params.id === req.user._id.toString() && req.body.isActive === false) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }

    const { name, email, password, role, isActive } = req.body;
    if (name?.trim())  user.name  = name.trim();
    if (email?.trim()) user.email = email.toLowerCase().trim();
    if (role && ['student', 'faculty', 'admin'].includes(role)) user.role = role;
    if (typeof isActive === 'boolean') user.isActive = isActive;

    // Only update password if a non-empty value is provided
    if (password && password.trim().length >= 6) {
      user.password = password.trim();
    } else if (password && password.trim().length > 0) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    await user.save();
    res.json({ _id: user._id, name: user.name, email: user.email, role: user.role, isActive: user.isActive });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Delete user
// @route DELETE /api/admin/users/:id
const deleteUser = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own account.' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    await user.deleteOne();
    res.json({ message: 'User removed.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Get system analytics
// @route GET /api/admin/analytics
const getSystemAnalytics = async (req, res) => {
  try {
    const [totalUsers, totalContent, totalModules, totalQuizzes, totalResults, totalRooms] =
      await Promise.all([
        User.countDocuments(),
        Content.countDocuments(),
        Module.countDocuments(),
        Quiz.countDocuments(),
        Result.countDocuments(),
        Room.countDocuments(),
      ]);

    const usersByRole  = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
    const recentUsers  = await User.find().select('-password').sort({ createdAt: -1 }).limit(5);

    res.json({ totalUsers, totalContent, totalModules, totalQuizzes, totalResults, totalRooms, usersByRole, recentUsers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Get API usage stats
// @route GET /api/admin/api-usage
const getApiUsageStats = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const [todayTotal, weekTotal, monthTotal, totalAll, byOperation, byUser, errors] =
      await Promise.all([
        ApiUsage.countDocuments({ createdAt: { $gte: todayStart } }),
        ApiUsage.countDocuments({ createdAt: { $gte: weekStart } }),
        ApiUsage.countDocuments({ createdAt: { $gte: monthStart } }),
        ApiUsage.countDocuments(),
        ApiUsage.aggregate([
          { $group: { _id: '$operation', count: { $sum: 1 }, successCount: { $sum: { $cond: ['$success', 1, 0] } } } },
        ]),
        ApiUsage.aggregate([
          { $match: { createdAt: { $gte: weekStart } } },
          { $group: { _id: '$triggeredBy', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
          { $project: { count: 1, 'user.name': 1, 'user.email': 1 } },
        ]),
        ApiUsage.countDocuments({ success: false }),
      ]);

    const dailyBreakdown = await ApiUsage.aggregate([
      { $match: { createdAt: { $gte: weekStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      todayTotal, weekTotal, monthTotal, totalAll,
      dailyLimit: DAILY_LIMIT,
      todayUsagePercent: Math.min(100, Math.round((todayTotal / DAILY_LIMIT) * 100)),
      byOperation, byUser, errors, dailyBreakdown,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getUsers, createUser, updateUser, deleteUser, getSystemAnalytics, getApiUsageStats };
