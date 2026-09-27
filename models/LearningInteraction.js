const mongoose = require('mongoose');

/**
 * LearningInteraction — append-only event log for research analysis.
 *
 * Every interaction (standard quiz question OR adaptive activity) is logged
 * here so the full adaptation trace can be reconstructed offline.
 *
 * Key research fields added in this revision:
 *   learningObjective — the cognitive target the system was pursuing
 *   isAdaptive        — distinguishes standard from adaptive events
 *   attemptNumber     — how many times this student has attempted this topic
 *
 * Do NOT embed these research fields into Result — keep Result clean.
 */
const learningInteractionSchema = new mongoose.Schema({
  studentId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  moduleId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Module' },
  topicId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Topic'  },
  resultId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Result' },
  adaptiveActivityId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdaptiveActivity' },
  questionId:         { type: String },
  sessionId:          { type: String },
  experimentId:       { type: String },

  // ── Activity classification ───────────────────────────────────────────────
  activityType: {
    type: String,
    enum: ['quiz_attempt', 'content_view', 'adaptive_content', 'adaptive_quiz'],
    default: 'quiz_attempt',
  },

  /**
   * isAdaptive: true  → system-triggered adaptive intervention
   *             false → standard quiz question
   * Allows experiments to separate baseline from adaptive events.
   */
  isAdaptive: { type: Boolean, default: false },

  // ── Assessment specification (adaptive contract fields) ───────────────────
  assessmentFormat: {
    type: String,
    enum: ['mcq', 'short_answer', 'code_completion', 'code_tracing', 'debugging', 'scenario_based'],
    default: 'mcq',
  },
  difficulty:       { type: String, enum: ['easy', 'normal', 'advanced'] },
  bloomLevel:       {
    type: String,
    enum: ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'],
  },

  /**
   * The specific learning objective the adaptive system was targeting.
   * Populated from the adaptation plan's learningObjective field.
   */
  learningObjective: { type: String, default: '' },

  // ── Outcome ───────────────────────────────────────────────────────────────
  score:     { type: Number, min: 0, max: 1 }, // normalised 0–1
  isCorrect: { type: Boolean },

  /**
   * attemptNumber: how many assessed interactions this student has had
   * for this topic at the time of this event.
   * Used for research analysis of learning curves.
   */
  attemptNumber: { type: Number, default: 1 },

  // ── Knowledge state snapshot ──────────────────────────────────────────────
  masteryBefore: { type: Number, min: 0, max: 1 },
  masteryAfter:  { type: Number, min: 0, max: 1 },

  // ── Adaptive system decision trace ────────────────────────────────────────
  /**
   * selectedStrategy: what the adaptation service chose.
   *   'standard'     — normal quiz, no adaptive decision
   *   'remediate'    — gap intervention triggered
   *   'reinforce'    — developing, needs practice
   *   'advance'      — mastered, ready for harder content
   */
  selectedStrategy: {
    type: String,
    enum: ['standard', 'remediate', 'reinforce', 'advance'],
    default: 'standard',
  },

  timestamp: { type: Date, default: Date.now },
});

// ── Indexes for efficient research queries ────────────────────────────────────
learningInteractionSchema.index({ studentId: 1, topicId: 1, timestamp: -1 });
learningInteractionSchema.index({ studentId: 1, moduleId: 1, timestamp: -1 });
learningInteractionSchema.index({ adaptiveActivityId: 1 });
learningInteractionSchema.index({ isAdaptive: 1, timestamp: -1 });
learningInteractionSchema.index({ timestamp: -1 });

module.exports = mongoose.model('LearningInteraction', learningInteractionSchema);
