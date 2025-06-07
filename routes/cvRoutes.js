// routes/cvRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');

// REMOVED: const cvController = require('../controllers/cvController');
// REMOVED: const { ensureAuthenticated } = require('../middleware/authMiddleware');

// The entire module is now a factory function that accepts its dependencies.
module.exports = (cvController, authMiddleware) => {

    // Configure multer for file uploads in memory. This logic remains inside
    // as it's specific to the routes defined in this file.
    const storage = multer.memoryStorage();
    const upload = multer({
        storage: storage,
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
        fileFilter: (req, file, cb) => {
            const allowedTypes = [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
            ];
            if (allowedTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type. Only PDF and DOCX are allowed.'), false);
            }
        }
    });

    // --- DEFINE CV-RELATED ROUTES ---
    // All routes use the injected 'authMiddleware' and 'cvController'.

    // GET /api/cv/info - Get metadata about the user's current CV
    router.get('/info', authMiddleware.ensureAuthenticated, cvController.getUserCvInfo);

    // POST /api/cv/upload - Upload/replace a user's CV
    router.post('/upload', authMiddleware.ensureAuthenticated, upload.single('cvFile'), cvController.uploadUserCv);

    // GET /api/cv/match - Trigger job matching using the saved CV
    router.get('/match', authMiddleware.ensureAuthenticated, cvController.getMatchesForUser);

    // Return the configured router to be used by server.js
    return router;
};
