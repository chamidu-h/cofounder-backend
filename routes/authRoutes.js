// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/github', authController.githubAuth);
router.get('/github/callback', authController.githubCallback);
router.get('/user', authenticateToken, authController.getUser);

module.exports = router;
