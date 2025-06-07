// routes/jobRoutes.js
const express = require('express');
const router = express.Router();

// REMOVED: const jobController = require('../controllers/jobController');

// The entire module is now a factory function that accepts its dependencies.
module.exports = (jobController, authMiddleware) => {

    // Route to get all job listings (publicly accessible, no auth middleware)
    router.get('/', jobController.getAllJobs);

    // Route to trigger the data import.
    // This is now protected and can only be accessed by an authenticated user.
    router.post('/import', authMiddleware.authenticateToken, jobController.importJobs);

    // Return the configured router to be used by server.js
    return router;
};
