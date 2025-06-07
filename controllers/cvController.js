// controllers/cvController.js

const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// REMOVED: const db = require('../services/databaseService');

// Helper function to extract text from an uploaded file buffer.
// It can remain at the module level as it doesn't depend on 'db'.
async function extractTextFromFile(fileBuffer, mimeType) {
    if (mimeType === 'application/pdf') {
        const data = await pdf(fileBuffer);
        return data.text;
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') { // .docx
        const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
        return value;
    }
    throw new Error('Unsupported file type. Please upload a PDF or DOCX file.');
}

// The entire module is now a factory function that accepts the 'db' instance.
module.exports = (db) => ({

    // Controller to handle CV upload and save it to the database
    uploadUserCv: async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'No CV file uploaded.' });
        }
        // Assumes auth middleware provides req.user.id
        const userId = req.user.id;

        try {
            const cvText = await extractTextFromFile(req.file.buffer, req.file.mimetype);
            if (!cvText || cvText.trim().length < 50) {
                return res.status(400).json({ message: 'Could not extract sufficient text from the CV.' });
            }

            // Use the injected 'db' object for all database operations
            const savedCv = await db.saveUserCv(userId, cvText, req.file.originalname);
            res.status(201).json({
                message: "CV uploaded and processed successfully.",
                cv: { originalFilename: savedCv.original_filename, updatedAt: savedCv.updated_at }
            });
        } catch (error) {
            console.error('[CV Upload] Error:', error);
            res.status(500).json({ message: 'Failed to process and save CV.' });
        }
    },

    // Controller to trigger job matching using the saved CV
    getMatchesForUser: async (req, res) => {
        const userId = req.user.id;

        try {
            // 1. Get the user's saved CV from the database using the injected 'db' object
            const userCv = await db.getUserCv(userId);
            if (!userCv || !userCv.cv_text) {
                return res.status(404).json({ message: "No CV found. Please upload a CV first." });
            }
            const cvText = userCv.cv_text;

            // 2. Perform Postgres Full-Text Search using the injected 'db' object
            const searchQuery = `
                SELECT
                    id, job_title, company_name, job_url, description_html,
                    ts_rank(searchable_text, plainto_tsquery('english', $1)) AS score
                FROM jobs
                WHERE searchable_text @@ plainto_tsquery('english', $1)
                AND ts_rank(searchable_text, plainto_tsquery('english', $1)) > 0.01
                ORDER BY score DESC
                LIMIT 25;
            `;
            const result = await db.query(searchQuery, [cvText]);
            const matchedJobs = result.rows;

            res.json({
                message: `Found ${matchedJobs.length} potential matches for your CV.`,
                matchedJobs: matchedJobs
            });
        } catch (error) {
            console.error('[CV Match] Error:', error);
            res.status(500).json({ message: 'An error occurred while matching jobs.' });
        }
    },

    // Controller to get info about the user's current CV
    getUserCvInfo: async (req, res) => {
        const userId = req.user.id;
        try {
            // Use the injected 'db' object
            const userCv = await db.getUserCv(userId);
            if (!userCv) {
                return res.status(404).json({ message: 'No CV on file.' });
            }
            res.json({
                cv: { originalFilename: userCv.original_filename, updatedAt: userCv.updated_at }
            });
        } catch (error) {
            console.error('Error fetching CV info:', error);
            res.status(500).json({ message: 'Failed to fetch CV info.' });
        }
    }
});
