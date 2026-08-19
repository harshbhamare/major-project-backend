const mongoose = require('mongoose');

const apiUsageSchema = new mongoose.Schema({
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  operation: {
    type: String,
    enum: ['extract_topics', 'generate_quiz'],
    required: true,
  },
  inputChars: { type: Number, default: 0 },  // chars sent to AI
  outputChars: { type: Number, default: 0 }, // chars received from AI
  model: { type: String, default: 'gemini-2.5-flash-lite' },
  success: { type: Boolean, default: true },
  error: { type: String },
  durationMs: { type: Number, default: 0 },
}, { timestamps: true });

// Index for efficient daily/faculty queries
apiUsageSchema.index({ createdAt: -1 });
apiUsageSchema.index({ triggeredBy: 1, createdAt: -1 });

module.exports = mongoose.model('ApiUsage', apiUsageSchema);
