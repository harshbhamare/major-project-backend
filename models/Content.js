const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileType: { type: String, enum: ['pdf', 'ppt', 'text', 'video', 'audio'], required: true },
  rawText: { type: String },
  fileName: { type: String },
  filePath: { type: String },
  transcription: { type: String },
  duration: { type: Number }, // for video/audio in seconds
  status: { type: String, enum: ['uploaded', 'processing', 'processed', 'failed'], default: 'uploaded' },
}, { timestamps: true });

module.exports = mongoose.model('Content', contentSchema);
