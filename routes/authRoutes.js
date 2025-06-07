const express = require('express');
const router = express.Router();

module.exports = (authController, authMiddleware) => {
  router.get('/github', authController.githubAuth);
  router.get('/github/callback', authController.githubCallback);
  router.get('/user', authMiddleware.authenticateToken, authController.getUser);
  return router;
};
