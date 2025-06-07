// controllers/cvController.js
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// --- HELPER FUNCTIONS ---

// This helper function remains unchanged.
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

/**
 * NEW: This function takes raw CV text, cleans it, and builds a Postgres-compatible
 * full-text search query string using the OR ('|') operator for better matching.
 * @param {string} rawText - The text extracted from the CV.
 * @returns {string} A query string like 'keyword1 | keyword2 | keyword3'.
 */
function createOrQueryFromCvText(rawText) {
    if (!rawText || rawText.trim().length === 0) {
        return '';
    }

    // A comprehensive set of common English stopwords to ignore.
    const stopwords = new Set([
        'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'com', 'for', 'from',
        'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
        'was', 'what', 'when', 'where', 'who', 'will', 'with', 'www', 'the', 'etc',
        'ltd', 'plc', 'sri', 'lanka', 'and', 'or', 'but', 'if', 'we', 'our', 'you', 'your'
    ]);

    // 1. Use regex to extract words, then convert to lowercase.
    const words = rawText.match(/\b\w+\b/g) || [];

    // 2. Filter out stopwords and very short words (e.g., less than 3 characters).
    const keywords = words
        .map(word => word.toLowerCase())
        .filter(word => word.length > 2 && !stopwords.has(word));

    // 3. Get only the unique keywords to build a cleaner and more efficient query.
    const uniqueKeywords = [...new Set(keywords)];

    // 4. Join the keywords with the OR operator for the tsquery.
    return uniqueKeywords.join(' | ');
}


// --- CONTROLLER ---

// The entire module is a factory function that accepts the 'db' instance.
module.exports = (db) => ({
    // This function remains unchanged as its logic is correct.
    uploadUserCv: async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'No CV file uploaded.' });
        }
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ message: 'Authentication error: User ID not found in token.' });
        }
        const userId = req.user.userId;
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
                return res.status(400).json({ message: "The uploaded PDF appears to be corrupted. Please try re-saving it and upload again." });
            }
            res.status(500).json({ message: 'An unexpected error occurred while processing your CV.' });
        }
    },

    // --- REFORMED getMatchesForUser function ---
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

            // 1. Create the OR-based query string from the user's CV text.
            const orQueryString = createOrQueryFromCvText(userCv.cv_text);

            if (orQueryString === '') {
                return res.json({ message: "Could not extract any relevant keywords from your CV.", matchedJobs: [] });
            }

            // 2. Use `to_tsquery` to respect the '|' operators in our new query string.
            const searchQuery = `
                SELECT
                    id, job_title, company_name, job_url, description_html,
                    ts_rank(searchable_text, to_tsquery('english', $1)) AS score
                FROM
                    jobs
                WHERE
                    searchable_text @@ to_tsquery('english', $1)
                ORDER BY
                    score DESC
                LIMIT 25;
            `;

            // 3. Pass the generated OR-query string as the parameter to the database.
            const result = await db.query(searchQuery, [orQueryString]);
            const matchedJobs = result.rows;

            res.json({
                message: `Found ${matchedJobs.length} relevant jobs based on your CV.`,
                matchedJobs: matchedJobs
            });
        } catch (error) {
            console.error(`[CV Match] Error for user ${userId}:`, error);
            res.status(500).json({ message: 'An error occurred while matching jobs.' });
        }
    },

    // This function remains unchanged as its logic is correct.
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
