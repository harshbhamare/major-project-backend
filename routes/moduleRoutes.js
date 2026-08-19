const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  createModule, getModules, getModule, updateModule,
  publishModule, assignModule, deleteModule,
} = require('../controllers/moduleController');

router.use(protect);
router.get('/', getModules);
router.get('/:id', getModule);
router.post('/', authorize('faculty', 'admin'), createModule);
router.put('/:id', authorize('faculty', 'admin'), updateModule);
router.put('/:id/publish', authorize('faculty', 'admin'), publishModule);
router.put('/:id/assign', authorize('faculty', 'admin'), assignModule);
router.delete('/:id', authorize('faculty', 'admin'), deleteModule);

module.exports = router;
