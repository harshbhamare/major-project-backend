/**
 * Assessment.js
 *
 * Unified Common Assessment Entity.
 * Supports all 6 assessment formats without creating separate independent models:
 *   - mcq
 *   - short_answer
 *   - code_completion
 *   - code_tracing
 *   - debugging
 *   - scenario_based
 *
 * Structure:
 *   - assessmentFormat
 *   - Common metadata (questionText, marks, difficulty, bloomLevel, learningObjective, explanation, topicId)
 *   - Format-specific payload (presentation data for student)
 *   - Format-specific evaluationData (secrets, model answers, rubrics; withheld pre-submission)
 */

const mongoose = require('mongoose');
const {
  SUPPORTED_FORMATS,
  SUPPORTED_DIFFICULTIES,
  SUPPORTED_BLOOM_LEVELS,
  validateAssessment,
} = require('../validators/assessmentValidator');

const assessmentSchema = new mongoose.Schema({
  assessmentFormat: {
    type: String,
    enum: SUPPORTED_FORMATS,
    required: true,
    default: 'mcq',
  },
  questionText: {
    type: String,
    required: true,
  },
  marks: {
    type: Number,
    default: 1,
  },
  difficulty: {
    type: String,
    enum: SUPPORTED_DIFFICULTIES,
    default: 'normal',
  },
  bloomLevel: {
    type: String,
    enum: SUPPORTED_BLOOM_LEVELS,
    default: 'understand',
  },
  learningObjective: {
    type: String,
    default: '',
  },
  explanation: {
    type: String,
    default: '',
  },
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic',
  },

  // ── Format-Specific Presentation Payload ──────────────────────────────────
  // Contains public rendering fields (e.g., options, codeSnippet, language, scenario, etc.)
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },

  // ── Format-Specific Evaluation Data ───────────────────────────────────────
  // Strictly server-side secrets (correctAnswer, modelAnswer, keywords, bugLocation, etc.)
  // NEVER exposed to the student before answer submission.
  evaluationData: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },

  // ── Backward Compatibility Fields ─────────────────────────────────────────
  // Synchronized with payload and evaluationData so existing quiz and result flows remain seamless
  options: [{ type: String }],
  correctAnswer: { type: String },
}, { timestamps: true });

// Synchronize legacy fields with payload/evaluationData before validation
assessmentSchema.pre('validate', function(next) {
  if (!this.payload) this.payload = {};
  if (!this.evaluationData) this.evaluationData = {};

  // Sync options between payload.options and legacy options
  if (Array.isArray(this.options) && this.options.length > 0 && (!this.payload.options || this.payload.options.length === 0)) {
    this.payload.options = this.options;
  } else if (Array.isArray(this.payload.options) && (!this.options || this.options.length === 0)) {
    this.options = this.payload.options;
  }

  // Sync correctAnswer between evaluationData and legacy correctAnswer
  const evalAnswer = this.evaluationData.correctAnswer ||
    this.evaluationData.expectedOutput ||
    this.evaluationData.correctCompletion ||
    this.evaluationData.modelAnswer ||
    this.evaluationData.bestChoice;

  if (this.correctAnswer && !evalAnswer) {
    this.evaluationData.correctAnswer = this.correctAnswer;
  } else if (evalAnswer && !this.correctAnswer) {
    this.correctAnswer = evalAnswer;
  }

  // Populate format-specific payload fallbacks if questionText contains snippets
  if (this.assessmentFormat === 'code_completion' && !this.payload.codeSnippet) {
    this.payload.codeSnippet = this.questionText;
  } else if (this.assessmentFormat === 'code_tracing' && !this.payload.codeSnippet) {
    this.payload.codeSnippet = this.questionText;
  } else if (this.assessmentFormat === 'debugging' && !this.payload.buggyCode) {
    this.payload.buggyCode = this.questionText;
  } else if (this.assessmentFormat === 'scenario_based' && !this.payload.scenario) {
    this.payload.scenario = this.questionText;
  }

  next();
});

module.exports = {
  assessmentSchema,
  Assessment: mongoose.model('Assessment', assessmentSchema),
};
