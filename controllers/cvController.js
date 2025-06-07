// controllers/cvController.js
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

async function extractTextFromFile(fileBuffer, mimeType) {
    if (mimeType === 'application/pdf') {
        const data = await pdf(fileBuffer);
        return data.text;
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
        return value;
    }
    throw new Error('Unsupported file type. Please upload a PDF or DOCX file.');
}

module.exports = (db) => ({
    uploadUserCv: async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'No CV file uploaded.' });
        }
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ message: 'Authentication error: User ID not found in token.' });
        }

        // --- THE CORE FIX ---
        // Access req.user.userId, which is set by your JWT creation logic.
        const userId = req.user.userId;
        console.log(`[CV Upload] Processing for user ID: ${userId}`);

        try {
            const cvText = await extractTextFromFile(req.file.buffer, req.file.mimetype);
            if (!cvText || cvText.trim().length < 50) {
                return res.status(400).json({ message: 'Could not extract sufficient text from the CV.' });
            }

            const savedCv = await db.saveUserCv(userId, cvText, req.file.originalname);
            res.status(201).json({
                message: "CV uploaded and processed successfully.",
                cv: { originalFilename: savedCv.original_filename, updatedAt: savedCv.updated_at }
            });
        } catch (error) {
            console.error(`[CV Upload] Error for user ${userId}:`, error.message);
            if (error.message && error.message.toLowerCase().includes('bad xref entry')) {
                return res.status(400).json({
                    message: "The uploaded PDF appears to be corrupted. Please try re-saving it and upload again."
                });
            }
            res.status(500).json({ message: 'An unexpected error occurred while processing your CV.' });
        }
    },

    getMatchesForUser: async (req, res) => {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ message: 'Authentication error: User ID not found in token.' });
        }
        const userId = req.user.userId;

        try {
            const userCv = await db.getUserCv(userId);
            if (!userCv || !userCv.cv_text) {
                return res.status(404).json({ message: "No CV found. Please upload a CV first." });
            }
            const cvText = userCv.cv_text;

            const searchQuery = `
                SELECT id, job_title, company_name, job_url, description_html,
                       ts_rank(searchable_text, plainto_tsquery('english', $1)) AS score
                FROM jobs
                WHERE searchable_text @@ plainto_tsquery('english', $1)
                  AND ts_rank(searchable_text, plainto_tsquery('english', $1)) > 0.01
                ORDER BY score DESC LIMIT 25;
            `;
            const result = await db.query(searchQuery, [cvText]);
            res.json({
                message: `Found ${result.rows.length} potential matches for your CV.`,
                matchedJobs: result.rows
            });
        } catch (error) {
            console.error(`[CV Match] Error for user ${userId}:`, error);
            res.status(500).json({ message: 'An error occurred while matching jobs.' });
        }
    },

    getUserCvInfo: async (req, res) => {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ message: 'Authentication error: User ID not found in token.' });
        }
        const userId = req.user.userId;

        try {
            const userCv = await db.getUserCv(userId);
            if (!userCv) {
                return res.status(404).json({ message: 'No CV on file.' });
            }
            res.json({
                cv: { originalFilename: userCv.original_filename, updatedAt: userCv.updated_at }
            });
        } catch (error) {
            console.error(`Error fetching CV info for user ${userId}:`, error);
            res.status(500).json({ message: 'Failed to fetch CV info.' });
        }
    }
});
