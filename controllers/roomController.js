const Room = require('../models/Room');
const Module = require('../models/Module');
const User = require('../models/User');
const QRCode = require('qrcode');
const { customAlphabet } = require('nanoid');

// 6-char uppercase code, unambiguous chars only
const genCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// ─── Faculty ──────────────────────────────────────────────────────────────────

// @route POST /api/rooms
const createRoom = async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Room name is required.' });

    let code, exists = true;
    while (exists) {
      code = genCode();
      exists = await Room.findOne({ code });
    }

    const room = await Room.create({
      name: name.trim(),
      description: description?.trim() || '',
      color: color || '#4ade80',
      code,
      createdBy: req.user._id,
    });

    res.status(201).json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/rooms  (faculty sees own rooms)
const getMyRooms = async (req, res) => {
  try {
    const rooms = await Room.find({ createdBy: req.user._id })
      .populate('members', 'name email')
      .populate('modules', 'title status difficulty')
      .sort({ createdAt: -1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/rooms/:id  (owner or member)
const getRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate('members', 'name email role')
      .populate('modules', 'title status difficulty topics')
      .populate('createdBy', 'name email');
    if (!room) return res.status(404).json({ message: 'Room not found.' });

    const isOwner = room.createdBy._id.toString() === req.user._id.toString();
    const isMember = room.members.some(m => m._id.toString() === req.user._id.toString());
    if (!isOwner && !isMember && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not a member of this room.' });
    }
    res.json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route PUT /api/rooms/:id
const updateRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    if (room.createdBy.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorised.' });

    const { name, description, color, isActive } = req.body;
    if (name) room.name = name.trim();
    if (description !== undefined) room.description = description.trim();
    if (color) room.color = color;
    if (typeof isActive === 'boolean') room.isActive = isActive;
    await room.save();
    res.json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route DELETE /api/rooms/:id
const deleteRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    if (room.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not authorised.' });
    await room.deleteOne();
    res.json({ message: 'Room deleted.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route POST /api/rooms/:id/modules  — add module to room
const addModuleToRoom = async (req, res) => {
  try {
    const { moduleId } = req.body;
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    if (room.createdBy.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorised.' });
    if (!room.modules.includes(moduleId)) room.modules.push(moduleId);
    await room.save();
    res.json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route DELETE /api/rooms/:id/modules/:moduleId
const removeModuleFromRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    if (room.createdBy.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorised.' });
    room.modules = room.modules.filter(m => m.toString() !== req.params.moduleId);
    await room.save();
    res.json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route DELETE /api/rooms/:id/members/:memberId  — kick member
const removeMember = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    if (room.createdBy.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorised.' });
    room.members = room.members.filter(m => m.toString() !== req.params.memberId);
    await room.save();
    res.json({ message: 'Member removed.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/rooms/:id/qr  — return QR as data-URL
const getRoomQR = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id).select('code name');
    if (!room) return res.status(404).json({ message: 'Room not found.' });
    if (room.createdBy && room.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not authorised.' });

    const joinUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/join/${room.code}`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#1a1d2e', light: '#ffffff' },
    });
    res.json({ qr: qrDataUrl, url: joinUrl, code: room.code });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Student ──────────────────────────────────────────────────────────────────

// @route POST /api/rooms/join  { code }
const joinRoom = async (req, res) => {
  try {
    const code = (req.body.code || '').toUpperCase().trim();
    if (!code) return res.status(400).json({ message: 'Room code is required.' });

    const room = await Room.findOne({ code, isActive: true })
      .populate('modules', 'title status difficulty topics')
      .populate('createdBy', 'name');
    if (!room) return res.status(404).json({ message: 'Invalid or inactive room code.' });

    const alreadyMember = room.members.some(m => m.toString() === req.user._id.toString());
    const isOwner = room.createdBy._id.toString() === req.user._id.toString();

    if (!alreadyMember && !isOwner) {
      room.members.push(req.user._id);
      await room.save();
    }

    res.json({ room, alreadyMember });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/rooms/mine  — rooms the student has joined
const getJoinedRooms = async (req, res) => {
  try {
    const rooms = await Room.find({ members: req.user._id, isActive: true })
      .populate('modules', 'title status difficulty topics')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/rooms/all  — admin only
const getAllRooms = async (req, res) => {
  try {
    const rooms = await Room.find()
      .populate('createdBy', 'name email')
      .populate('members', 'name')
      .sort({ createdAt: -1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createRoom, getMyRooms, getRoom, updateRoom, deleteRoom,
  addModuleToRoom, removeModuleFromRoom, removeMember, getRoomQR,
  joinRoom, getJoinedRooms, getAllRooms,
};
