const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  createRoom, getMyRooms, getRoom, updateRoom, deleteRoom,
  addModuleToRoom, removeModuleFromRoom, removeMember, getRoomQR,
  joinRoom, getJoinedRooms, getAllRooms,
} = require('../controllers/roomController');

router.use(protect);

// ── Student ──────────────────────────────────────────────────────────────────
router.post('/join', joinRoom);
router.get('/mine', getJoinedRooms);

// ── Faculty / Admin ──────────────────────────────────────────────────────────
router.get('/all', authorize('admin'), getAllRooms);
router.post('/', authorize('faculty', 'admin'), createRoom);
router.get('/', authorize('faculty', 'admin'), getMyRooms);
router.get('/:id', getRoom);
router.put('/:id', authorize('faculty', 'admin'), updateRoom);
router.delete('/:id', authorize('faculty', 'admin'), deleteRoom);
router.get('/:id/qr', authorize('faculty', 'admin'), getRoomQR);
router.post('/:id/modules', authorize('faculty', 'admin'), addModuleToRoom);
router.delete('/:id/modules/:moduleId', authorize('faculty', 'admin'), removeModuleFromRoom);
router.delete('/:id/members/:memberId', authorize('faculty', 'admin'), removeMember);

module.exports = router;
