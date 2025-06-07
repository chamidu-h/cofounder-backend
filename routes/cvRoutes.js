// routes/cvRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cvController = require('../controllers/cvController');
const { ensureAuthenticated } = require('../middleware/authMiddleware'); // Your existing auth middleware

// Configure multer for file uploads in memory
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
// All routes require a logged-in user.

// GET /api/cv/info - Get metadata about the user's current CV
router.get('/info', ensureAuthenticated, cvController.getUserCvInfo);

// POST /api/cv/upload - Upload/replace a user's CV
router.post('/upload', ensureAuthenticated, upload.single('cvFile'), cvController.uploadUserCv);

// GET /api/cv/match - Trigger job matching using the saved CV
router.get('/match', ensureAuthenticated, cvController.getMatchesForUser);

module.exports = router;
