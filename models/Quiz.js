const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String }],
  correctAnswer: { type: String, required: true },
  marks: { type: Number, default: 1 },
  difficulty: { type: String, enum: ['easy', 'normal', 'advanced'], default: 'normal' },
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
});

const quizSchema = new mongoose.Schema({
  title: { type: String, required: true },
  moduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
  questions: [questionSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  timeLimit: { type: Number, default: 30 }, // minutes
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
}, { timestamps: true });

module.exports = mongoose.model('Quiz', quizSchema);
