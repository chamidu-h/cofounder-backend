// controllers/cvController.js
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
// Import the new AI service to be used for re-ranking
const aiRerankService = require('../services/aiRerankService');

// --- HELPER FUNCTIONS ---

// This helper function extracts text from documents and remains unchanged.
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
 * This function takes raw CV text, cleans it, and builds a Postgres-compatible
 * full-text search query string using the OR ('|') operator for better matching.
 * @param {string} rawText - The text extracted from the CV.
 * @returns {string} A query string like 'keyword1 | keyword2 | keyword3'.
 */
function createOrQueryFromCvText(rawText) {
    if (!rawText || rawText.trim().length === 0) {
        return '';
    }
    const stopwords = new Set([
        'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'com', 'for', 'from',
        'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
        'was', 'what', 'when', 'where', 'who', 'will', 'with', 'www', 'etc',
        'ltd', 'plc', 'sri', 'lanka', 'but', 'if', 'we', 'our', 'you', 'your'
    ]);
    const words = rawText.match(/\b\w+\b/g) || [];
    const keywords = words
        .map(word => word.toLowerCase())
        .filter(word => word.length > 2 && !stopwords.has(word));
    const uniqueKeywords = [...new Set(keywords)];
    return uniqueKeywords.join(' | ');
}


// --- CONTROLLER ---

// The entire module is a factory function that accepts the 'db' instance.
module.exports = (db) => ({
    // This function remains unchanged as its logic is correct and working.
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

    // --- REFORMED getMatchesForUser function with AI Re-Ranking ---
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

            // --- STEP 1: Get Initial Candidates (The Fast Funnel) ---
            const orQueryString = createOrQueryFromCvText(cvText);
            if (orQueryString === '') {
                return res.json({ message: "Could not extract any relevant keywords from your CV.", matchedJobs: [] });
            }
            const searchQuery = `
                SELECT id, job_title, company_name, job_url, description_html,
                       ts_rank(searchable_text, to_tsquery('english', $1)) AS score
                FROM jobs WHERE searchable_text @@ to_tsquery('english', $1)
                ORDER BY score DESC LIMIT 10;
            `;
            const initialResults = await db.query(searchQuery, [orQueryString]);
            const initialMatches = initialResults.rows;

            if (initialMatches.length === 0) {
                return res.json({ message: "No initial text-based matches found.", matchedJobs: [] });
            }

            // --- STEP 2: Get AI Score for Each Candidate (The Deep Analysis) ---
            console.log(`[AI Re-rank] Analyzing ${initialMatches.length} matches for user ${userId}...`);
            const analysisPromises = initialMatches.map(job =>
                aiRerankService.getAiRank(cvText, job.description_html)
            );
            const aiResults = await Promise.all(analysisPromises);

            // --- STEP 3: Calculate Blended Score and Re-Rank (The Final Result) ---
            const pgWeight = 0.3; // 30% weight for the keyword match score
            const aiWeight = 0.7; // 70% weight for the AI's fundamental understanding score
            const maxPgScore = initialMatches[0].score > 0 ? initialMatches[0].score : 1; // Avoid division by zero

            const rerankedJobs = initialMatches.map((job, index) => {
                const aiScore = aiResults[index].aiScore;
                // Normalize the keyword score to a 0-1 scale
                const normalizedPgScore = job.score / maxPgScore;
                // Calculate the final blended score
                const finalScore = (normalizedPgScore * pgWeight) + ((aiScore / 100) * aiWeight);

                return {
                    ...job,
                    aiAnalysis: {
                        score: aiScore,
                        reason: aiResults[index].reason
                    },
                    finalScore: finalScore // This is the new score for ranking
                };
            });

            // Sort the jobs by the new, more accurate finalScore
            rerankedJobs.sort((a, b) => b.finalScore - a.finalScore);

            console.log(`[AI Re-rank] Re-ranking complete for user ${userId}.`);
            res.json({
                message: `Found and re-ranked the ${rerankedJobs.length} most relevant jobs.`,
                matchedJobs: rerankedJobs
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
