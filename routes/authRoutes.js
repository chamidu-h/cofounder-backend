// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Initiate GitHub OAuth flow
router.get('/github', authController.githubAuth);

// GitHub OAuth callback
router.get('/github/callback', authController.githubCallback);

module.exports = router;
