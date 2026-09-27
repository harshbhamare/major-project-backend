const mongoose = require('mongoose');

/**
 * questionSchema — extended with Bloom's taxonomy fields per spec §16.
 *
 * IMPORTANT: difficulty ≠ cognitive level (spec §13).
 *   difficulty   = how hard the task is (easy | normal | advanced)
 *   bloomLevel   = the cognitive process required (remember → create)
 *   assessmentFormat = type of task presented to the student
 */
const questionSchema = new mongoose.Schema({
  questionText:     { type: String, required: true },
  options:          [{ type: String }],
  correctAnswer:    { type: String, required: true },
  marks:            { type: Number, default: 1 },
  difficulty:       { type: String, enum: ['easy', 'normal', 'advanced'], default: 'normal' },
  topicId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  explanation:      { type: String, default: '' },

  // ── Adaptive learning extensions (spec §14, §16) ──────────────────────────
  bloomLevel: {
    type: String,
    enum: ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'],
    default: 'understand',
  },
  learningObjective: { type: String, default: '' },
  assessmentFormat: {
    type: String,
    enum: ['mcq', 'short_answer', 'code_completion', 'code_tracing', 'debugging', 'scenario_based'],
    default: 'mcq',
  },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  evaluationData: { type: mongoose.Schema.Types.Mixed, default: {} },
});

const quizSchema = new mongoose.Schema({
  title:     { type: String, required: true },
  moduleId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
  questions: [questionSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  timeLimit: { type: Number, default: 30 }, // minutes
  status:    { type: String, enum: ['draft', 'published'], default: 'draft' },

  // Marks this quiz as adaptive (generated for a specific learner gap)
  isAdaptive:   { type: Boolean, default: false },
  targetTopicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
}, { timestamps: true });

module.exports = mongoose.model('Quiz', quizSchema);
