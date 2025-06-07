// services/aiRerankService.js
const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

/**
 * Analyzes a CV against a job description to provide a "Fundamental Match Score".
 * @param {string} cvText - The full text of the user's CV.
 * @param {string} jobDescription - The full text of the job description.
 * @returns {Promise<{aiScore: number, reason: string}>}
 */
async function getAiRank(cvText, jobDescription) {
    // --- REFINED PROMPT ---
    const prompt = `
        As an expert HR Technology Recruiter, your task is to provide a "Fundamental Match Score" from 1 to 100 evaluating how qualified a candidate is for a job based on their CV.

        - A score of 1-30 indicates a CLEAR MISMATCH (e.g., intern CV for a senior role).
        - A score of 31-70 indicates a PLAUSIBLE MATCH (e.g., some skills overlap, right experience level).
        - A score of 71-100 indicates a STRONG MATCH (e.g., experience and core technologies align well).

        Here is the candidate's CV:
        ---
        ${cvText}
        ---

        Here is the job description:
        ---
        ${jobDescription}
        ---

        Analyze the CV against the job description. Your response MUST be a single, valid JSON object and NOTHING ELSE. Do not include any introductory text, reasoning, or explanations outside of the JSON structure. The JSON object must contain ONLY these two keys:
        1. "ai_score": A number from 1 to 100.
        2. "reason": A single, concise sentence explaining the score.
    `;

    try {
        const completion = await groq.chat.completions.create({
            model: 'qwen-qwq-32b', // Your specified Qwen model
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 200,
        });

        const jsonResponse = JSON.parse(completion.choices[0].message.content);
        const aiScore = parseInt(jsonResponse.ai_score, 10);
        if (isNaN(aiScore) || aiScore < 1 || aiScore > 100) {
            throw new Error("AI response 'ai_score' is not a valid number between 1 and 100.");
        }
        return { aiScore: aiScore, reason: jsonResponse.reason || "Analysis complete." };

    } catch (error) {
        console.error("[AI Re-rank] Groq API call failed:", error);
        return { aiScore: 50, reason: "AI analysis could not be completed for this job." };
    }
}

module.exports = { getAiRank };
