const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  code: { type: String, required: true, unique: true, uppercase: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  modules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Module' }],
  isActive: { type: Boolean, default: true },
  color: { type: String, default: '#4ade80' }, // display accent colour
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
