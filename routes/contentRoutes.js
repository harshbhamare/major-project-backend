const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadContent, processContent, getMyContent, getContentTopics } = require('../controllers/contentController');
const ApiUsage = require('../models/ApiUsage');
const { DAILY_LIMIT } = require('../config/aiService');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.ppt', '.pptx', '.mp4', '.avi', '.mov', '.mp3', '.wav', '.m4a'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, PPT, Video, and Audio files are allowed.'));
  },
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

router.use(protect, authorize('faculty', 'admin'));

// ── Static routes MUST come before /:id param routes ──────────────────────
router.get('/', getMyContent);
router.post('/upload', upload.single('file'), uploadContent);

// Faculty API usage — must be before /:id routes
router.get('/usage/stats', async (req, res) => {
  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0, 0, 0, 0);

    const [todayCount, weekCount, totalCount] = await Promise.all([
      ApiUsage.countDocuments({ triggeredBy: req.user._id, createdAt: { $gte: todayStart } }),
      ApiUsage.countDocuments({ triggeredBy: req.user._id, createdAt: { $gte: weekStart } }),
      ApiUsage.countDocuments({ triggeredBy: req.user._id }),
    ]);

    const dailyBreakdown = await ApiUsage.aggregate([
      { $match: { triggeredBy: req.user._id, createdAt: { $gte: weekStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      todayCount, weekCount, totalCount,
      dailyLimit: DAILY_LIMIT,
      todayPercent: Math.min(100, Math.round((todayCount / DAILY_LIMIT) * 100)),
      dailyBreakdown,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Param routes ───────────────────────────────────────────────────────────
router.post('/:id/process', processContent);
router.get('/:id/topics', getContentTopics);

module.exports = router;
