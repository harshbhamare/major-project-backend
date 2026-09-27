const mongoose = require('mongoose');

/**
 * AdaptiveActivity — one document per generated adaptive intervention.
 *
 * Stores:
 *   - the full adaptation plan that triggered this activity
 *   - the AI-generated content (explanation/example)
 *   - the AI-generated question (correct answer stored server-side)
 *   - the student's submitted answer + outcome
 *
 * correctAnswer is intentionally kept here and NEVER sent to the client
 * in the generate response. It is only revealed after submission.
 */
const questionSchema = new mongoose.Schema({
  questionText:      { type: String },
  options:           [{ type: String }],
  correctAnswer:     { type: String },   // server-side only
  marks:             { type: Number, default: 1 },
  difficulty:        { type: String, enum: ['easy', 'normal', 'advanced'] },
  bloomLevel:        { type: String },
  assessmentFormat:  { type: String, enum: ['mcq', 'short_answer', 'code_completion', 'code_tracing', 'debugging', 'scenario_based'] },
  learningObjective: { type: String },
  explanation:       { type: String },
  payload:           { type: mongoose.Schema.Types.Mixed, default: {} },
  evaluationData:    { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const adaptiveActivitySchema = new mongoose.Schema({
  studentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  moduleId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
  topicId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Topic',  required: true },

  // The full adaptation plan that triggered this activity (for research traceability)
  plan: { type: mongoose.Schema.Types.Mixed },

  // AI-generated learning content
  content: { type: mongoose.Schema.Types.Mixed },

  // AI-generated question (correctAnswer stored but never sent before submission)
  question: questionSchema,

  // Cognitive & format specification (mirrored from question/plan for direct indexing)
  assessmentFormat:  { type: String, enum: ['mcq', 'short_answer', 'code_completion', 'code_tracing', 'debugging', 'scenario_based'] },
  difficulty:        { type: String, enum: ['easy', 'normal', 'advanced'] },
  bloomLevel:        { type: String },
  learningObjective: { type: String },

  // Submission outcome & defensible evaluation metadata
  status:             { type: String, enum: ['pending', 'completed'], default: 'pending' },
  studentAnswer:      { type: mongoose.Schema.Types.Mixed },
  isCorrect:          { type: Boolean },
  score:              { type: Number, min: 0, max: 1 },
  masteryBefore:      { type: Number, min: 0, max: 1 },
  masteryAfter:       { type: Number, min: 0, max: 1 },
  submissionMetadata: { type: mongoose.Schema.Types.Mixed }, // evaluator, criteriaResults, feedback, duration
  submittedAt:        { type: Date },

  // Optional research experiment identifiers
  experimentId:       { type: String },
  sessionId:          { type: String },
}, { timestamps: true });

adaptiveActivitySchema.index({ studentId: 1, moduleId: 1, createdAt: -1 });
adaptiveActivitySchema.index({ studentId: 1, topicId: 1, createdAt: -1 });
adaptiveActivitySchema.index({ status: 1, studentId: 1, moduleId: 1 });

module.exports = mongoose.model('AdaptiveActivity', adaptiveActivitySchema);
