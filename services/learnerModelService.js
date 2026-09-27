/**
 * learnerModelService.js
 *
 * Responsible for WHAT is known — maintains the persistent per-student,
 * per-topic knowledge state.
 *
 * Architecture (spec §5):
 *   learnerModelService → decides/updates knowledge state
 *   adaptationService  → decides what the learner receives next
 *   aiService          → HOW the LLM generates content/assessment
 *
 * Do NOT put mastery/adaptation logic in aiService.
 *
 * Trend fix (spec §10, handoff §3):
 *   Previous implementation compared only current score vs stored recentAccuracy.
 *   This revision queries the last TREND_WINDOW LearningInteraction records for the
 *   topic and computes trend from the slope of those scores. Requires at least 2
 *   records. Returns 'stable' when insufficient history exists.
 *
 * averageDifficulty note (handoff §5):
 *   The field is intentionally renamed conceptually to "lastDifficulty" in comments
 *   but kept as averageDifficulty in the schema for backward compatibility.
 *   It stores the difficulty of the most recent assessment, not a true average.
 *   This is documented clearly so it is not overclaimed in research output.
 */

const LearnerKnowledge    = require('../models/LearnerKnowledge');
const LearningInteraction = require('../models/LearningInteraction');

// ── Hyperparameters (to be validated experimentally — spec §7) ─────────────
const ALPHA                 = parseFloat(process.env.MASTERY_ALPHA          || '0.3');  // EMA learning rate
const MIN_ATTEMPTS          = parseInt(  process.env.MIN_ATTEMPTS            || '3',  10); // Minimum assessed interactions before gap eligibility
const TREND_WINDOW          = parseInt(  process.env.TREND_WINDOW            || '3',  10); // interactions used for trend
const TREND_SLOPE_THRESHOLD = parseFloat(process.env.TREND_SLOPE_THRESHOLD  || '0.10'); // Slope threshold per window

// ─── Trend calculation (3-window, from LearningInteraction history) ───────────

/**
 * Compute trend by fetching the last TREND_WINDOW - 1 scored interactions
 * for this student+topic from the LearningInteraction log, then appending currentScore.
 *
 * Excludes any interaction that might match the current event timestamp/id to
 * prevent duplicating the current score.
 *
 * Returns: 'improving' | 'stable' | 'declining'
 */
async function computeTrendFromHistory(studentId, topicId, currentScore, excludeInteractionId = null) {
  try {
    const query = {
      studentId,
      topicId,
      score: { $exists: true, $ne: null },
    };
    if (excludeInteractionId) {
      query._id = { $ne: excludeInteractionId };
    }

    const recent = await LearningInteraction.find(query)
      .sort({ timestamp: -1 })
      .limit(TREND_WINDOW - 1) // fetch previous (N-1); current is appended below
      .select('score timestamp');

    // Build a chronological window: older first, newest last
    const scores = [...recent.map(r => r.score).reverse(), currentScore];

    if (scores.length < 2) return 'stable'; // Not enough history

    // Simple linear slope: compare mean of first half vs mean of second half
    const mid       = Math.floor(scores.length / 2);
    const earlyMean = scores.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
    const lateMean  = scores.slice(mid).reduce((s, v) => s + v, 0) / (scores.length - mid);
    const slope     = lateMean - earlyMean;

    if (slope >  TREND_SLOPE_THRESHOLD) return 'improving';
    if (slope < -TREND_SLOPE_THRESHOLD) return 'declining';
    return 'stable';
  } catch (err) {
    console.error('computeTrendFromHistory error (non-fatal):', err.message);
    return 'stable'; // Safe default — never block a mastery update
  }
}

// ─── Core mastery update ──────────────────────────────────────────────────────

/**
 * Update mastery for a single topic using EMA.
 *
 * M_new = α × S + (1 − α) × M_old    (α = 0.3)
 *
 * @param {ObjectId|string} studentId
 * @param {ObjectId|string} topicId
 * @param {number}          normalizedScore  0.0 – 1.0
 * @param {string}          difficulty       'easy' | 'normal' | 'advanced'
 * @returns {{ before: number, after: number, record: LearnerKnowledge }}
 */
const updateTopicMastery = async (studentId, topicId, normalizedScore, difficulty = 'normal') => {
  // Upsert: create the record if it doesn't exist yet
  let record = await LearnerKnowledge.findOneAndUpdate(
    { studentId, topicId },
    { $setOnInsert: { studentId, topicId } },
    { upsert: true, new: true }
  );

  const masteryBefore = record.mastery;

  // EMA mastery update
  const masteryAfter = Math.min(1, Math.max(0,
    ALPHA * normalizedScore + (1 - ALPHA) * masteryBefore
  ));

  // 3-window trend from interaction history
  const trend = await computeTrendFromHistory(studentId, topicId, normalizedScore);

  // averageDifficulty stores most recent difficulty; lastDifficulty is the preferred modern field
  record.mastery           = masteryAfter;
  record.recentAccuracy    = normalizedScore;
  record.attemptCount     += 1;
  record.trend             = trend;
  record.lastDifficulty    = difficulty;
  record.averageDifficulty = difficulty;
  record.lastAssessedAt    = new Date();

  await record.save();

  return { before: masteryBefore, after: masteryAfter, record };
};

// ─── Batch update from quiz answers ──────────────────────────────────────────

/**
 * Group submitted answers by topicId and update mastery independently per topic.
 * Per spec §8: mastery is never updated from the overall quiz percentage.
 *
 * @param {ObjectId|string} studentId
 * @param {Array} processedAnswers — [{ topicId, isCorrect, marks, difficulty }]
 * @returns {Object} topicId (string) → { before, after, record }
 */
const updateMasteryFromAnswers = async (studentId, processedAnswers) => {
  // Group answers by topicId
  const topicGroups = {};
  for (const ans of processedAnswers) {
    if (!ans.topicId) continue;
    const key = ans.topicId.toString();
    if (!topicGroups[key]) {
      topicGroups[key] = { correct: 0, total: 0, difficulty: ans.difficulty || 'normal' };
    }
    topicGroups[key].total += 1;
    if (ans.isCorrect) topicGroups[key].correct += 1;
  }

  const updates = {};
  for (const [topicId, group] of Object.entries(topicGroups)) {
    const normalizedScore = group.total > 0 ? group.correct / group.total : 0;
    updates[topicId] = await updateTopicMastery(studentId, topicId, normalizedScore, group.difficulty);
  }

  return updates; // topicId → { before, after, record }
};

// ─── Gap classification ───────────────────────────────────────────────────────

/**
 * Classify mastery into knowledge states (spec §9).
 * If attemptCount is 0, no evidence exists yet -> 'not_assessed'.
 */
const classifyKnowledgeState = (mastery, attemptCount = 1) => LearnerKnowledge.classify(mastery, attemptCount);

/**
 * Return topics that need intervention, ordered by priority.
 *
 * Priority = gap size (primary) + declining trend (tiebreaker).
 *
 * Requires MIN_ATTEMPTS interactions before a topic is eligible for
 * gap intervention — prevents noisy switching from a single bad answer.
 *
 * @param {ObjectId|string} studentId
 * @param {Array}           topicIds
 * @returns {Array} sorted by priority
 */
const getKnowledgeGaps = async (studentId, topicIds) => {
  const records = await LearnerKnowledge.find({
    studentId,
    topicId: { $in: topicIds },
  }).populate('topicId', 'title difficulty');

  return records
    .filter(r => r.attemptCount >= MIN_ATTEMPTS)
    .filter(r => classifyKnowledgeState(r.mastery, r.attemptCount) !== 'mastered')
    .map(r => ({
      topicId:    r.topicId,
      mastery:    r.mastery,
      state:      classifyKnowledgeState(r.mastery, r.attemptCount),
      gap:        1 - r.mastery,
      trend:      r.trend,
      attempts:   r.attemptCount,
      difficulty: r.lastDifficulty || r.averageDifficulty,
    }))
    .sort((a, b) => {
      if (Math.abs(a.gap - b.gap) > 0.05) return b.gap - a.gap; // larger gap first
      if (a.trend === 'declining' && b.trend !== 'declining') return -1;
      if (b.trend === 'declining' && a.trend !== 'declining') return  1;
      return 0;
    });
};

/**
 * Get the knowledge state map for all topics of a student in a module.
 * Returns topicId (string) → LearnerKnowledge record.
 */
const getLearnerStateForModule = async (studentId, topicIds) => {
  const records = await LearnerKnowledge.find({
    studentId,
    topicId: { $in: topicIds },
  });
  const map = {};
  for (const r of records) map[r.topicId.toString()] = r;
  return map;
};

/**
 * Get the current attemptCount for a student+topic.
 * Used by resultController to populate LearningInteraction.attemptNumber.
 */
const getAttemptCount = async (studentId, topicId) => {
  const record = await LearnerKnowledge.findOne({ studentId, topicId }).select('attemptCount');
  return record?.attemptCount || 0;
};

module.exports = {
  updateTopicMastery,
  updateMasteryFromAnswers,
  classifyKnowledgeState,
  getKnowledgeGaps,
  getLearnerStateForModule,
  getAttemptCount,
  ALPHA,
  MIN_ATTEMPTS,
  TREND_WINDOW,
  TREND_SLOPE_THRESHOLD,
};
