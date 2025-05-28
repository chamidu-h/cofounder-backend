// routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController'); // You need to implement this
const { authenticateToken } = require('../middleware/authMiddleware'); // You need to implement this

router.post('/generate', authenticateToken, profileController.generateProfile);
router.post('/save', authenticateToken, profileController.saveProfile);

// These routes match what the fixed frontend apiService.js will now call
router.get('/saved', authenticateToken, profileController.getSavedProfile); // GET /api/profile/saved
router.delete('/saved', authenticateToken, profileController.deleteProfile); // DELETE /api/profile/saved

// If you want a general GET /api/profile for the user's own profile, you might add:
// router.get('/', authenticateToken, profileController.getOwnProfile); // GET /api/profile
// And then apiService.js getSavedProfile would point to /profile instead of /profile/saved.
// For now, sticking to /saved as per PDF.

module.exports = router;
