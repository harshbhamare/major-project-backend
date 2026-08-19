const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId },
  selectedAnswer: { type: String },
  isCorrect: { type: Boolean },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
});

const resultSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  moduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Module' },
  answers: [answerSchema],
  score: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  timeTaken: { type: Number }, // seconds
  weakTopics: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Topic' }],
  recommendedDifficulty: { type: String, enum: ['easy', 'normal', 'advanced'], default: 'normal' },
}, { timestamps: true });

module.exports = mongoose.model('Result', resultSchema);
