// services/groqService.js
const Groq = require("groq-sdk").default || require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Extracts the first balanced JSON object from raw text.
 * Throws if no valid JSON block is found.
 */
function extractAndValidateJson(raw) {
  const start = raw.indexOf("{");
  if (start === -1) {
    throw new Error("No '{' found in model output");
  }

  let depth = 0;
  let end = -1;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error("No matching '}' found for JSON object");
  }

  const jsonText = raw.substring(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    console.error("JSON.parse failed on extracted text:", jsonText);
    throw new Error("Extracted text is not valid JSON");
  }

  // Validate schema fields
  const required = [
    "professionalOverview",
    "headline",
    "coFounderSummary",
    "keyStrengths",
    "potentialRoles",
    "projectInsights",
    "identifiedTechnologies",
    "architecturalConcepts",
    "estimatedExperience"
  ];
  for (const field of required) {
    if (!(field in parsed)) {
      throw new Error(`Missing required field in JSON: ${field}`);
    }
  }

  return parsed;
}

/**
 * Main function to generate co-founder profile
 */
async function parseProfile(combinedText, languageStats, repos) {
  const systemPrompt = `
You are an expert co-founder-matching AI. Analyze the provided GitHub data and generate a professional co-founder profile.
Follow the schema strictly and ensure all fields are concise and relevant.

Output ONLY a JSON object matching this schema:

{
  "professionalOverview": "string",
  "headline": "string",
  "coFounderSummary": "string",
  "keyStrengths": ["string", ...],
  "potentialRoles": ["string", ...],
  "projectInsights": [
    { "name": "string", "highlight": "string" }
    // 3 to 5 items
  ],
  "identifiedTechnologies": ["string", ...],
  "architecturalConcepts": ["string", ...],
  "estimatedExperience": "string"
}

Do not include markdown or any text outside the JSON. Base your analysis on the GitHub repositories, 
language stats, and overall activity patterns.
`;

  const userPrompt = `
Analyze the following GitHub data and generate a co-founder profile:

GitHub Summary:
${combinedText}

Language Stats:
${JSON.stringify(languageStats, null, 2)}

Repositories:
${repos.map(r => `- ${r.name}: updated_at=${r.updated_at}`).join("\n")}

Generate a JSON response matching the schema above. Focus on technical expertise, 
collaboration potential, and entrepreneurial value. Ensure all fields are concise 
and tailored for a co-founder matching platform.

Return ONLY the JSON object; do not return thinking or any other additional texts.
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "qwen/qwen3-32b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   }
      ],
      temperature: 0.0
    });

    const raw = completion.choices[0]?.message?.content || "";
    console.log("Raw Groq response:", raw);

    return extractAndValidateJson(raw);
  } catch (error) {
    console.error("Error in parseProfile:", error);
    throw error;
  }
}

module.exports = { parseProfile };
