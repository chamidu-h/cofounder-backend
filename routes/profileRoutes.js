// routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController'); 
const suggestionController = require('../controllers/suggestionController'); // New
const connectionController = require('../controllers/connectionController'); // New
const { authenticateToken } = require('../middleware/authMiddleware'); 

// Existing Profile Routes
router.post('/generate', authenticateToken, profileController.generateProfile);
router.post('/save', authenticateToken, profileController.saveProfile);
router.get('/saved', authenticateToken, profileController.getSavedProfile); 
router.delete('/saved', authenticateToken, profileController.deleteProfile); 



// New Suggestion Routes
router.get('/suggestions', authenticateToken, suggestionController.getSuggestions);

// New Connection Routes
// Base path for these will be /api/profile/connections/...
router.post('/connections/request', authenticateToken, connectionController.sendRequest);
router.get('/connections/pending', authenticateToken, connectionController.getPendingRequests);
router.get('/connections/sent', authenticateToken, connectionController.getSentRequests);
// For accepting, route is POST /api/profile/connections/accept (requesterId in body)
router.post('/connections/accept', authenticateToken, connectionController.acceptRequest); 
router.delete('/connections/:connectionId/decline', authenticateToken, connectionController.declineOrCancelRequest);
router.get('/connections/active', authenticateToken, connectionController.getActiveConnections);

// New route to get a specific user's public profile
// The :userId here will be the ID of the user whose profile is being viewed
router.get('/:userId', authenticateToken, profileController.getUserPublicProfile); // GET /api/profile/:userId

module.exports = router;
