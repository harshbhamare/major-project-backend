const Module = require('../models/Module');
const Topic = require('../models/Topic');
const User = require('../models/User');
const Room = require('../models/Room');

// @desc Create a module
// @route POST /api/modules
const createModule = async (req, res) => {
  const { title, description, topicIds, difficulty } = req.body;
  const module = await Module.create({
    title,
    description,
    topics: topicIds || [],
    createdBy: req.user._id,
    difficulty: difficulty || 'normal',
  });

  // Link topics to this module
  if (topicIds && topicIds.length > 0) {
    await Topic.updateMany({ _id: { $in: topicIds } }, { moduleId: module._id });
  }

  res.status(201).json(module);
};

// @desc Get all modules (faculty sees own, students see room + assigned only)
// @route GET /api/modules
const getModules = async (req, res) => {
  let query = {};
  if (req.user.role === 'faculty') {
    query.createdBy = req.user._id;
  } else if (req.user.role === 'student') {
    // Collect module IDs from all joined rooms
    const joinedRooms = await Room.find({ members: req.user._id, isActive: true }).select('modules');
    const roomModuleIds = joinedRooms.flatMap(r => r.modules.map(m => m.toString()));

    // Students ONLY see:
    // 1. Modules explicitly assigned to them
    // 2. Modules that belong to a room they joined
    // NOT all published modules — that caused the global leakage
    if (roomModuleIds.length === 0) {
      // Only show modules explicitly assigned to this student
      query = { status: 'published', assignedTo: req.user._id };
    } else {
      query.status = 'published';
      query.$or = [
        { assignedTo: req.user._id },
        { _id: { $in: roomModuleIds } },
      ];
    }
  }
  const modules = await Module.find(query)
    .populate('topics')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });
  res.json(modules);
};

// ─── shared access helper ────────────────────────────────────────────────────
const studentCanAccessModule = async (userId, moduleId) => {
  const module = await Module.findById(moduleId).select('status assignedTo');
  if (!module || module.status !== 'published') return false;

  // Explicitly assigned
  if (module.assignedTo?.map(id => id.toString()).includes(userId.toString())) return true;

  // Via a joined room
  const room = await Room.findOne({
    members: userId,
    modules: moduleId,
    isActive: true,
  }).select('_id');
  return !!room;
};

// @desc Get single module
// @route GET /api/modules/:id
const getModule = async (req, res) => {
  const module = await Module.findById(req.params.id)
    .populate('topics')
    .populate('createdBy', 'name');
  if (!module) return res.status(404).json({ message: 'Module not found' });

  // Students must have access via room or assignment
  if (req.user.role === 'student') {
    const allowed = await studentCanAccessModule(req.user._id, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'You do not have access to this module.' });
  }

  res.json(module);
};

// @desc Update module
// @route PUT /api/modules/:id
const updateModule = async (req, res) => {
  const module = await Module.findById(req.params.id);
  if (!module) return res.status(404).json({ message: 'Module not found' });
  if (module.createdBy.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { title, description, topicIds, difficulty } = req.body;
  if (title) module.title = title;
  if (description) module.description = description;
  if (difficulty) module.difficulty = difficulty;
  if (topicIds) {
    module.topics = topicIds;
    await Topic.updateMany({ _id: { $in: topicIds } }, { moduleId: module._id });
  }

  await module.save();
  res.json(module);
};

// @desc Publish/unpublish module
// @route PUT /api/modules/:id/publish
const publishModule = async (req, res) => {
  const module = await Module.findById(req.params.id);
  if (!module) return res.status(404).json({ message: 'Module not found' });
  if (module.createdBy.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Not authorized' });
  }
  module.status = module.status === 'published' ? 'draft' : 'published';
  await module.save();
  res.json(module);
};

// @desc Assign module to students
// @route PUT /api/modules/:id/assign
const assignModule = async (req, res) => {
  const { studentIds } = req.body;
  const module = await Module.findById(req.params.id);
  if (!module) return res.status(404).json({ message: 'Module not found' });
  module.assignedTo = studentIds;
  await module.save();
  res.json(module);
};

// @desc Delete module
// @route DELETE /api/modules/:id
const deleteModule = async (req, res) => {
  const module = await Module.findById(req.params.id);
  if (!module) return res.status(404).json({ message: 'Module not found' });
  await module.deleteOne();
  res.json({ message: 'Module removed' });
};

module.exports = { createModule, getModules, getModule, updateModule, publishModule, assignModule, deleteModule, studentCanAccessModule };
