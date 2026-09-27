const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { getNextLearningAction, getLearnerModuleSummary } = require('../services/adaptationService');
const { generateAdaptiveContent } = require('../config/aiService');
const LearnerKnowledge = require('../models/LearnerKnowledge');

router.use(protect);

// @desc  Get the next learning action for a student in a module
// @route GET /api/adaptation/next/:moduleId
router.get('/next/:moduleId', authorize('student'), async (req, res) => {
  try {
    const plan = await getNextLearningAction(req.user._id, req.params.moduleId);
    res.json(plan || { hasGap: false, action: 'no_action', reason: 'No data available yet.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @desc  Get learner knowledge state summary for a module
// @route GET /api/adaptation/summary/:moduleId
router.get('/summary/:moduleId', authorize('student'), async (req, res) => {
  try {
    const summary = await getLearnerModuleSummary(req.user._id, req.params.moduleId);
    res.json(summary || { topicSummaries: [], avgMastery: null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @desc  Generate adaptive content for a topic gap
// @route POST /api/adaptation/content
router.post('/content', authorize('student'), async (req, res) => {
  try {
    const { plan, topicSummary } = req.body;
    if (!plan || !plan.topicTitle) {
      return res.status(400).json({ message: 'Adaptation plan is required.' });
    }
    const content = await generateAdaptiveContent(plan, topicSummary || '', req.user._id);
    res.json(content);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @desc  Get all topic mastery records for the logged-in student
// @route GET /api/adaptation/mastery
router.get('/mastery', authorize('student'), async (req, res) => {
  try {
    const records = await LearnerKnowledge.find({ studentId: req.user._id })
      .populate('topicId', 'title difficulty')
      .sort({ mastery: 1 });

    res.json(records.map(r => ({
      topicId:    r.topicId?._id,
      topicTitle: r.topicId?.title || 'Unknown',
      mastery:    Math.round(r.mastery * 100) / 100,
      state:      LearnerKnowledge.classify(r.mastery),
      trend:      r.trend,
      attempts:   r.attemptCount,
      lastAssessedAt: r.lastAssessedAt,
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @desc  Faculty/Admin: get knowledge state for all students in a module
// @route GET /api/adaptation/module/:moduleId/insights
router.get('/module/:moduleId/insights', authorize('faculty', 'admin'), async (req, res) => {
  try {
    const Module = require('../models/Module');
    const module = await Module.findById(req.params.moduleId).populate('topics', 'title');
    if (!module) return res.status(404).json({ message: 'Module not found.' });

    const topicIds = module.topics.map(t => t._id);
    const records  = await LearnerKnowledge.find({ topicId: { $in: topicIds } })
      .populate('studentId', 'name email')
      .populate('topicId', 'title');

    // Aggregate per-topic class averages
    const topicAverages = {};
    for (const r of records) {
      const key = r.topicId?._id?.toString();
      if (!key) continue;
      if (!topicAverages[key]) topicAverages[key] = { title: r.topicId.title, masteries: [] };
      topicAverages[key].masteries.push(r.mastery);
    }

    const topicInsights = Object.entries(topicAverages).map(([topicId, data]) => ({
      topicId,
      topicTitle:  data.title,
      avgMastery:  Math.round((data.masteries.reduce((s, m) => s + m, 0) / data.masteries.length) * 100) / 100,
      studentCount: data.masteries.length,
      needsIntervention: data.masteries.filter(m => m < 0.6).length,
    }));

    res.json({ moduleTitle: module.title, topicInsights, totalRecords: records.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @desc  Research Analytics (spec §26): mastery trajectories, formats, strategies, gains, accuracy
// @route GET /api/adaptation/module/:moduleId/research-analytics
router.get('/module/:moduleId/research-analytics', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const LearningInteraction = require('../models/LearningInteraction');
    const AdaptiveActivity    = require('../models/AdaptiveActivity');
    const Module              = require('../models/Module');
    const LearnerKnowledge    = require('../models/LearnerKnowledge');

    const [interactions, activities, moduleDoc] = await Promise.all([
      LearningInteraction.find({ moduleId })
        .populate('topicId', 'title')
        .sort({ timestamp: 1 }),
      AdaptiveActivity.find({ moduleId })
        .select('status isCorrect submittedAt score masteryBefore masteryAfter assessmentFormat difficulty bloomLevel'),
      Module.findById(moduleId).populate('topics', 'title difficulty'),
    ]);

    const totalInteractions = interactions.length;
    const adaptiveInteractions = interactions.filter(i => i.isAdaptive);
    const baselineInteractions = interactions.filter(i => !i.isAdaptive);

    const adaptiveCorrect = adaptiveInteractions.filter(i => i.isCorrect).length;
    const baselineCorrect = baselineInteractions.filter(i => i.isCorrect).length;

    const adaptiveAccuracy = adaptiveInteractions.length > 0
      ? Math.round((adaptiveCorrect / adaptiveInteractions.length) * 100)
      : null;
    const baselineAccuracy = baselineInteractions.length > 0
      ? Math.round((baselineCorrect / baselineInteractions.length) * 100)
      : null;

    // Distributions
    const formats = {};
    const strategies = {};
    const bloomLevels = {};
    const difficulties = {};
    let totalMasteryGain = 0;
    let gainsCount = 0;

    for (const i of interactions) {
      if (i.assessmentFormat) formats[i.assessmentFormat] = (formats[i.assessmentFormat] || 0) + 1;
      if (i.selectedStrategy) strategies[i.selectedStrategy] = (strategies[i.selectedStrategy] || 0) + 1;
      if (i.bloomLevel) bloomLevels[i.bloomLevel] = (bloomLevels[i.bloomLevel] || 0) + 1;
      if (i.difficulty) difficulties[i.difficulty] = (difficulties[i.difficulty] || 0) + 1;

      if (i.isAdaptive && i.masteryBefore != null && i.masteryAfter != null) {
        totalMasteryGain += (i.masteryAfter - i.masteryBefore);
        gainsCount++;
      }
    }

    const totalActivities = activities.length;
    const completedActivities = activities.filter(a => a.status === 'completed').length;
    const completionRate = totalActivities > 0
      ? Math.round((completedActivities / totalActivities) * 100)
      : 100;

    const avgMasteryGain = gainsCount > 0
      ? Math.round((totalMasteryGain / gainsCount) * 1000) / 1000
      : 0;

    // Per-topic knowledge trajectory summaries
    const topicIds = moduleDoc?.topics?.map(t => t._id) || [];
    const knowledgeRecords = await LearnerKnowledge.find({ topicId: { $in: topicIds } });

    const topicStats = (moduleDoc?.topics || []).map(t => {
      const records = knowledgeRecords.filter(r => r.topicId.toString() === t._id.toString());
      const studentCount = records.length;
      const avgMastery = studentCount > 0
        ? Math.round((records.reduce((s, r) => s + r.mastery, 0) / studentCount) * 100) / 100
        : null;
      const interventionCount = records.filter(r => r.mastery < 0.60).length;
      return {
        topicId:           t._id,
        topicTitle:        t.title,
        studentCount,
        avgMastery,
        interventionCount,
        targetDifficulty:  t.difficulty,
      };
    });

    res.json({
      moduleId,
      moduleTitle: moduleDoc?.title || 'Module',
      totalInteractions,
      adaptiveCount: adaptiveInteractions.length,
      baselineCount: baselineInteractions.length,
      adaptiveAccuracy,
      baselineAccuracy,
      formatDistribution: formats,
      strategyDistribution: strategies,
      bloomDistribution: bloomLevels,
      difficultyDistribution: difficulties,
      avgMasteryGain,
      adaptiveInterventionsCount: totalActivities,
      adaptiveCompletionRate: completionRate,
      topicStats,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @desc  Export raw chronological research trace (spec §16, §24)
// @route GET /api/adaptation/module/:moduleId/research-trace
router.get('/module/:moduleId/research-trace', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const LearningInteraction = require('../models/LearningInteraction');

    const interactions = await LearningInteraction.find({ moduleId })
      .populate('studentId', 'name email role')
      .populate('topicId', 'title')
      .sort({ timestamp: 1 });

    // Pseudonymize student IDs for scientific research privacy
    const studentMap = new Map();
    let pCount = 1;

    const trace = interactions.map(i => {
      const rawId = i.studentId?._id?.toString() || 'anonymous';
      if (!studentMap.has(rawId)) {
        studentMap.set(rawId, `P${String(pCount++).padStart(3, '0')}`);
      }
      const participantId = studentMap.get(rawId);

      return {
        participantId,
        interactionId:       i._id,
        adaptiveActivityId:  i.adaptiveActivityId || null,
        resultId:            i.resultId || null,
        topicId:             i.topicId?._id || i.topicId,
        topicTitle:          i.topicId?.title || 'Unknown',
        isAdaptive:          i.isAdaptive,
        condition:           i.isAdaptive ? 'adaptive' : 'baseline',
        activityType:        i.activityType,
        selectedStrategy:    i.selectedStrategy,
        assessmentFormat:    i.assessmentFormat,
        difficulty:          i.difficulty,
        bloomLevel:          i.bloomLevel,
        learningObjective:   i.learningObjective,
        score:               i.score,
        isCorrect:           i.isCorrect,
        attemptNumber:       i.attemptNumber,
        masteryBefore:       i.masteryBefore,
        masteryAfter:        i.masteryAfter,
        masteryGain:         (i.masteryAfter != null && i.masteryBefore != null)
          ? Math.round((i.masteryAfter - i.masteryBefore) * 1000) / 1000
          : null,
        timestamp:           i.timestamp,
      };
    });

    res.json({
      moduleId,
      totalRecords: trace.length,
      participantsCount: studentMap.size,
      exportedAt: new Date().toISOString(),
      trace,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
