const mongoose = require('mongoose');

/**
 * LearnerKnowledge — one document per student–topic pair.
 * Stores the current persistent knowledge state of a student for a specific topic.
 *
 * Mastery update rule (exponential moving average):
 *   M_new = α × S + (1 − α) × M_old   where α = 0.3 (configurable)
 *
 * This is an initial operational hyperparameter to be validated experimentally,
 * not a universal constant.
 */
const learnerKnowledgeSchema = new mongoose.Schema({
  studentId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  topicId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', required: true },

  // Core mastery estimate: 0.0 (no knowledge) → 1.0 (fully mastered)
  mastery:         { type: Number, default: 0.5, min: 0, max: 1 },

  // Accuracy on the most recent assessment window (0–1)
  recentAccuracy:  { type: Number, default: 0.5, min: 0, max: 1 },

  // Total number of assessed interactions for this topic
  attemptCount:    { type: Number, default: 0, min: 0 },

  // Performance trend across recent attempts
  trend:           { type: String, enum: ['improving', 'stable', 'declining'], default: 'stable' },

  // Difficulty level of the most recent assessment
  // lastDifficulty is the primary name; averageDifficulty is preserved for backward compatibility
  lastDifficulty:    { type: String, enum: ['easy', 'normal', 'advanced'], default: 'normal' },
  averageDifficulty: { type: String, enum: ['easy', 'normal', 'advanced'], default: 'normal' },

  // Timestamp of the last assessment that updated this record
  lastAssessedAt:  { type: Date, default: Date.now },
}, { timestamps: true });

// Compound unique index: one document per student–topic pair
learnerKnowledgeSchema.index({ studentId: 1, topicId: 1 }, { unique: true });

// Mastery classification thresholds (spec §9)
// If attemptCount is 0, no assessment has been recorded yet — return 'not_assessed'
learnerKnowledgeSchema.statics.classify = function (mastery, attemptCount = 1) {
  if (attemptCount === 0) return 'not_assessed';
  if (mastery >= 0.80) return 'mastered';
  if (mastery >= 0.60) return 'developing';
  return 'needs_intervention';
};

module.exports = mongoose.model('LearnerKnowledge', learnerKnowledgeSchema);
