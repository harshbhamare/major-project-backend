const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { updateTopic, deleteTopic, getTopic } = require('../controllers/topicController');

router.use(protect);
router.get('/:id', getTopic);
router.put('/:id', authorize('faculty', 'admin'), updateTopic);
router.delete('/:id', authorize('faculty', 'admin'), deleteTopic);

module.exports = router;
