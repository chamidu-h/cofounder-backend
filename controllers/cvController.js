// controllers/cvController.js
const db = require('../services/databaseService');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// Helper function to extract text from an uploaded file buffer
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

// Controller to handle CV upload and save it to the database
exports.uploadUserCv = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No CV file uploaded.' });
    }
    const userId = req.user.id; // From your auth middleware

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
        console.error('[CV Upload] Error:', error);
        res.status(500).json({ message: 'Failed to process and save CV.' });
    }
};

// Controller to trigger job matching using the saved CV
exports.getMatchesForUser = async (req, res) => {
    const userId = req.user.id;

    try {
        // 1. Get the user's saved CV from the database
        const userCv = await db.getUserCv(userId);
        if (!userCv || !userCv.cv_text) {
            return res.status(404).json({ message: "No CV found. Please upload a CV first." });
        }
        const cvText = userCv.cv_text;

        // 2. Perform Postgres Full-Text Search
        const searchQuery = `
            SELECT
                id, job_title, company_name, job_url, description_html,
                ts_rank(searchable_text, plainto_tsquery('english', $1)) AS score
            FROM jobs
            WHERE searchable_text @@ plainto_tsquery('english', $1)
            AND ts_rank(searchable_text, plainto_tsquery('english', $1)) > 0.01 -- Filter out very low scores
            ORDER BY score DESC
            LIMIT 25; -- Return the top 25 potential matches
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
};

// Controller to get info about the user's current CV
exports.getUserCvInfo = async (req, res) => {
    const userId = req.user.id;
    try {
        const userCv = await db.getUserCv(userId);
        if (!userCv) {
            return res.status(404).json({ message: 'No CV on file.' });
        }
        res.json({
            cv: { originalFilename: userCv.original_filename, updatedAt: userCv.updated_at }
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch CV info.' });
    }
};
