const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  title: { type: String, required: true },
  summary: { type: String },
  difficulty: { type: String, enum: ['easy', 'normal', 'advanced'], default: 'normal' },
  contentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content' },
  moduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Module' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  order: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Topic', topicSchema);
