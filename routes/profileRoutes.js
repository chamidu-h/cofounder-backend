// routes/profileRoutes.js
const express = require('express');
const router = express.Router();

// REMOVED: const profileController = require('../controllers/profileController');
// REMOVED: const suggestionController = require('../controllers/suggestionController');
// REMOVED: const connectionController = require('../controllers/connectionController');
// REMOVED: const { authenticateToken } = require('../middleware/authMiddleware');

// The entire module is now a factory function that accepts all its dependencies.
module.exports = (profileController, suggestionController, connectionController, authMiddleware) => {

    // --- Profile Routes ---
    // All routes use the injected 'authMiddleware' and controllers.
    router.post('/generate', authMiddleware.authenticateToken, profileController.generateProfile);
    router.post('/save', authMiddleware.authenticateToken, profileController.saveProfile);
    router.get('/saved', authMiddleware.authenticateToken, profileController.getSavedProfile);
    router.delete('/saved', authMiddleware.authenticateToken, profileController.deleteProfile);

    // --- Suggestion Routes ---
    router.get('/suggestions', authMiddleware.authenticateToken, suggestionController.getSuggestions);

    // --- Connection Routes ---
    // Base path for these will be /api/profile/connections/...
    router.post('/connections/request', authMiddleware.authenticateToken, connectionController.sendRequest);
    router.get('/connections/pending', authMiddleware.authenticateToken, connectionController.getPendingRequests);
    router.get('/connections/sent', authMiddleware.authenticateToken, connectionController.getSentRequests);
    router.post('/connections/accept', authMiddleware.authenticateToken, connectionController.acceptRequest);
    router.delete('/connections/:connectionId/decline', authMiddleware.authenticateToken, connectionController.declineOrCancelRequest);
    router.get('/connections/active', authMiddleware.authenticateToken, connectionController.getActiveConnections);

    // --- Public Profile Route ---
    // NOTE: This route must be last, as the ':userId' is a wildcard that would otherwise
    // capture routes like '/suggestions' or '/saved'.
    router.get('/:userId', authMiddleware.authenticateToken, profileController.getUserPublicProfile);

    // Return the configured router to be used by server.js
    return router;
};
