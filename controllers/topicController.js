const Topic = require('../models/Topic');

// @desc Update a topic
// @route PUT /api/topics/:id
const updateTopic = async (req, res) => {
  try {
    const topic = await Topic.findById(req.params.id);
    if (!topic) return res.status(404).json({ message: 'Topic not found.' });

    const { title, summary, difficulty } = req.body;
    if (title?.trim())   topic.title      = title.trim();
    if (summary !== undefined) topic.summary = summary; // allow empty string to clear
    if (difficulty && ['easy', 'normal', 'advanced'].includes(difficulty)) {
      topic.difficulty = difficulty;
    }

    await topic.save();
    res.json(topic);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Delete a topic
// @route DELETE /api/topics/:id
const deleteTopic = async (req, res) => {
  try {
    const topic = await Topic.findById(req.params.id);
    if (!topic) return res.status(404).json({ message: 'Topic not found.' });
    await topic.deleteOne();
    res.json({ message: 'Topic removed.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc Get a single topic
// @route GET /api/topics/:id
const getTopic = async (req, res) => {
  try {
    const topic = await Topic.findById(req.params.id);
    if (!topic) return res.status(404).json({ message: 'Topic not found.' });
    res.json(topic);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { updateTopic, deleteTopic, getTopic };
