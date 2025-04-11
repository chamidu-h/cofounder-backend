// services/geminiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Ensure API key is loaded from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is not set.");
}

// Initialize the GoogleGenerativeAI client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// Use the specific stable model identifier
// Try the latest recommended Pro model if 1.0 fails
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

/**
 * Creates the detailed analysis prompt for Gemini.
 * @param {object} profileData - The intermediate profile data object.
 * @returns {string} The formatted prompt string.
 */
const createGeminiPrompt = (profileData) => {
  // Use the robust prompt structure defined previously
  return `
## Role:
You are an expert Technical Talent Analyst and Profile Writer specializing in evaluating software developer profiles for potential co-founder roles in tech startups.

## Task:
Analyze the provided JSON data representing a user's GitHub profile information. Based *only* on this data, generate insightful, concise, and professionally worded content suitable for a co-founder recommendation platform. Your goal is to interpret the raw data (languages, repositories, descriptions, README snippets) to highlight the user's potential strengths, technical capabilities, project impact, and suitability for collaboration in a startup environment. Focus on inference, synthesis, and industrial relevance rather than simply repeating the input.

## Input Data:
You will receive a JSON object containing the user's GitHub profile data structured as follows:
\`\`\`json
{
  "personal": { // Basic user info },
  "technical": {
    "languageStats": { /* Language percentages */ },
    "repoCount": ...,
    "repos": [
      {
        "name": "...",
        "description": "...",
        // *** THIS FIELD IS NOW A SUMMARY ***
        "summary": "Pre-summarized text of the repository's README and description.",
        "languages": { /* Languages for this repo */ },
        "pushed_at": "...",
        "stargazers_count": ...
      },
      ...
    ],
    // *** THIS FIELD CONTAINS COMBINED SUMMARIES ***
    "combinedRepoSummaries": "Concatenated summaries of multiple repositories."
  }
}
\`\`\`

## Output Requirements:
Generate a **single, valid JSON object** as your response. This JSON object **must** contain the following keys, with values derived from your analysis of the input data:

1.  \`headline\`: (String) A concise, compelling tagline summarizing the user's core technical identity (e.g., "Kotlin & Java Backend Specialist with Full-Stack Experience").
2.  \`coFounderSummary\`: (String) A short paragraph (2-4 sentences) summarizing the user's key technical strengths and potential value as a co-founder. Highlight their primary domain (backend, mobile, etc.) and mention their ability to build complete systems if evident.
3.  \`keyStrengths\`: (Array of Strings) A list of 4-6 key technical capabilities or areas of expertise inferred from their projects and language usage (e.g., "Backend API Development (Kotlin/Java)", "RESTful Service Design", "Android Application Development", "React Frontend Basics", "Database Integration (MySQL)").
4.  \`potentialRoles\`: (Array of Strings) A list of 3-5 potential roles this individual might fill effectively in a startup context, based on their skills (e.g., "Backend Engineer", "API Developer", "Technical Co-founder", "Full-Stack Developer (Java/Kotlin focus)", "Android Developer").
5.  \`projectInsights\`: (Array of Objects) An array analyzing the most significant repositories (choose 2-4 most indicative ones based on activity, complexity, or relevance). Each object in the array should have the following keys:
    *   \`projectName\`: (String) The original repository name (\`repo.name\`).
    *   \`synopsis\`: (String) A brief (1-2 sentences) interpretation of the project's goal and the user's likely role/contribution, going beyond the literal description. Infer the *purpose* (e.g., "Developed the core backend logic for a news platform using Kotlin.").
    *   \`keyTechnologies\`: (Array of Strings) List the primary technologies identified for *this specific project* (e.g., ["Kotlin", "REST API"], ["Java", "Swing", "MySQL"], ["JavaScript", "React", "CSS"]).
    *   \`inferredContributions\`: (Array of Strings) List 2-3 specific technical skills or concepts demonstrated by this project (e.g., "API endpoint implementation", "Database schema design", "UI development with Swing", "Component-based frontend structure").
    *   \`complexityImpact\`: (String) A brief qualitative assessment (e.g., "Demonstrates backend service creation", "Shows full-stack application development capability", "Indicates experience with desktop GUI and database interaction").
6.  \`identifiedTechnologies\`: (Array of Strings) A consolidated list of specific technologies, frameworks, and libraries mentioned or strongly implied across all projects and language stats (e.g., "Kotlin", "Java", "JavaScript", "React", "CSS", "HTML", "REST APIs", "Java Swing", "MySQL", "Git", "Android SDK (Inferred)"). Be more specific than just languages where possible (like inferring "React" from \`create-react-app\` text).
7.  \`architecturalConcepts\`: (Array of Strings) A list of 2-4 higher-level architectural patterns or software engineering concepts demonstrated or implied by the projects (e.g., "Client-Server Architecture", "RESTful API Design", "MVC/MVVM Pattern (Inferred)", "Database-Driven Applications").
8.  \`estimatedExperience\`: (String) Based *purely* on the project diversity, technologies, and apparent complexity, provide a cautious estimate of experience level (e.g., "Early-Career Developer showing promise", "Mid-Level Developer with diverse project experience", "Experienced in building multi-component systems"). If unsure, state "Experience level estimation difficult from data".

## Important Instructions:
*   Analyze the relationships between projects (e.g., \`newsreporter-backend\`, \`newsreporter\`, \`newsreporter-editor-dashboard\` likely form a single system).
*   Infer skills and technologies based on project descriptions, languages used, and common practices (e.g., a Kotlin/Java mobile app likely uses Android SDK; \`create-react-app\` implies React).
*   Use professional, objective, and slightly promotional language suitable for highlighting potential.
*   Ensure the output is **strictly** a valid JSON object containing only the keys specified above. Do not include any explanatory text outside the JSON structure itself or markdown formatting like \`\`\`json.

`;
};

/**
 * Analyzes profile data using Google Gemini API.
 * @param {object} profileData - The structured profile data fetched from GitHub.
 * @returns {Promise<object|null>} - The parsed JSON analysis from Gemini, or null if an error occurs.
 */
exports.analyzeProfileData = async (profileData) => {
  const prompt = createGeminiPrompt(profileData);

  try {
    console.log("Sending request to Gemini API...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text(); // Get the raw text response

    // Clean the response: Remove potential markdown code fences (```json ... ```)
    const cleanedText = text.replace(/^```json\s*|```\s*$/g, '').trim();

    console.log("Received raw response from Gemini:", cleanedText); // Log the cleaned text

    // Attempt to parse the cleaned text as JSON
    const analysis = JSON.parse(cleanedText);
    console.log("Successfully parsed Gemini response.");
    return analysis;

  } catch (error) {
    console.error("Error calling or parsing Gemini API:", error);
    // Log potential details from the error if available
    if (error.response) {
        console.error("Gemini API Error Response:", error.response.data);
    } else {
        console.error("Error details:", error.message);
    }
    // Check if the raw text might contain useful error info from Gemini itself
    if (typeof text !== 'undefined' && text) {
        console.error("Raw Gemini response text (potentially containing error):", text);
    }
    return null; // Indicate failure
  }
};