// routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/generate', authenticateToken, profileController.generateProfile);
router.post('/save', authenticateToken, profileController.saveProfile);
router.get('/saved', authenticateToken, profileController.getSavedProfile);
router.delete('/saved', authenticateToken, profileController.deleteProfile);

module.exports = router;
