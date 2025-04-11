// services/profileService.js
const githubService = require('./githubService');
const summarizerService = require('./summarizerService');
const geminiService = require('./geminiService'); // <-- Import the Gemini service

// Helper function (optional but recommended for large READMEs before summarization)
const truncateText = (text, maxLength = 8000) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
};


exports.generateUserProfile = async (accessToken) => {
    try {
        // --- Existing Steps 1-3: Fetch Data & Repo Details ---
        const userData = await githubService.getUserData(accessToken);
        const reposData = await githubService.getUserRepos(accessToken);

        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

        const filteredRepos = reposData.filter(repo => {
            const updatedAt = new Date(repo.updated_at);
            // Keep original filtering, but also grab fields needed for Gemini context later
            return !repo.fork && updatedAt >= twelveMonthsAgo;
        });

        const repoDetailsPromises = filteredRepos.map(async (repo) => {
            try {
                const owner = repo.owner.login;
                const repoName = repo.name;
                const [readme, languages] = await Promise.all([
                    githubService.getRepoReadme(accessToken, owner, repoName),
                    githubService.getRepoLanguages(accessToken, owner, repoName)
                ]);
                const description = repo.description || '';
                // Keep original structure for summarization step
                return {
                    // Include fields needed for summarization AND Gemini context
                    name: repo.name,
                    description,
                    readme: readme || '', // Raw readme for summarization
                    languages: languages || {},
                    // Add fields potentially useful for Gemini's analysis context
                    pushed_at: repo.pushed_at,
                    stargazers_count: repo.stargazers_count,
                    html_url: repo.html_url // Link might be useful context
                };
            } catch (innerError) {
                console.error(`Error processing repository ${repo.name}:`, innerError);
                return null;
            }
        });

        const repoDetails = await Promise.all(repoDetailsPromises);
        const validRepoDetails = repoDetails.filter(detail => detail !== null);

        // --- Existing Step 4: Aggregate Language Statistics ---
        const aggregatedLanguages = {};
        validRepoDetails.forEach(repo => {
            for (const lang in repo.languages) {
                aggregatedLanguages[lang] = (aggregatedLanguages[lang] || 0) + repo.languages[lang];
            }
        });
        const totalLanguageBytes = Object.values(aggregatedLanguages).reduce((sum, bytes) => sum + bytes, 0);
        const languagePercentages = {};
        for (const lang in aggregatedLanguages) {
            languagePercentages[lang] = totalLanguageBytes > 0
                ? ((aggregatedLanguages[lang] / totalLanguageBytes) * 100).toFixed(2)
                : '0.00';
        }

        // --- Existing Step 5: Summarize Each Repository ---
        const summarizationOptions = { max_length: 150, min_length: 30 }; // Use your preferred options
        // Store summaries mapped by repo name for easier lookup later
        const repoSummariesMap = {};
        const repoSummariesPromises = validRepoDetails.map(async (repo) => {
            // Consider truncating very long readme *before* sending to summarizer if needed
            const textToSummarize = `${repo.description} ${truncateText(repo.readme, 8000)}`.trim();
            let repoSummaryResult = `${repo.name}: No detailed content available.`; // Default
            if (textToSummarize) {
                const summary = await summarizerService.summarizeText(textToSummarize, summarizationOptions);
                // Store just the summary text, mapping it to the repo name
                repoSummariesMap[repo.name] = (summary && summary !== textToSummarize) ? summary : repo.description || "Summary not generated.";
                repoSummaryResult = `${repo.name}: ${repoSummariesMap[repo.name]}`; // Keep format for combinedText
            } else {
                 repoSummariesMap[repo.name] = "No detailed content available.";
            }
            return repoSummaryResult; // Return the formatted string for joining later
        });

        const repoSummariesArray = await Promise.all(repoSummariesPromises);
        const combinedTextFromSummaries = repoSummariesArray.join('\n\n'); // This is your original `finalSummary`

        // --- NEW Step 6: Prepare Data and Call Gemini ---
        let geminiAnalysis = null; // Initialize as null

        // Prepare the input specifically structured for the Gemini prompt
        const dataForGemini = {
            personal: {
                login: userData.login,
                name: userData.name,
                bio: userData.bio || '',
            },
            technical: {
                languageStats: languagePercentages,
                repoCount: validRepoDetails.length,
                // Provide repo details *including* the summary we just generated
                repos: validRepoDetails.map(repo => ({
                    name: repo.name,
                    description: repo.description,
                    summary: repoSummariesMap[repo.name] || "N/A", // Get summary from the map
                    languages: repo.languages,
                    pushed_at: repo.pushed_at,
                    stargazers_count: repo.stargazers_count,
                    html_url: repo.html_url
                })),
                // Provide the combined summaries as context
                combinedRepoSummaries: combinedTextFromSummaries
            }
        };

        try {
            console.log("Calling Gemini service for profile analysis...");
            geminiAnalysis = await geminiService.analyzeProfileData(dataForGemini);
            if (!geminiAnalysis) {
                console.warn("Gemini analysis returned null or failed. Proceeding without AI insights.");
            } else {
                console.log("Gemini analysis successful.");
            }
        } catch (geminiError) {
            console.error("Error during Gemini analysis call:", geminiError);
            // Keep geminiAnalysis as null, proceed with fallback
        }

        // --- Modified Step 7: Construct Final Profile ---
        const structuredProfile = {
            personal: { // Personal data remains the same
                login: userData.login,
                name: userData.name,
                bio: userData.bio,
                avatar_url: userData.avatar_url,
                html_url: userData.html_url,
            },
            // Technical data structure depends on Gemini success
            technical: geminiAnalysis // If Gemini succeeded, use its structured output
                ? {
                    analysisStatus: 'success',
                    headline: geminiAnalysis.headline,
                    coFounderSummary: geminiAnalysis.coFounderSummary,
                    keyStrengths: geminiAnalysis.keyStrengths,
                    potentialRoles: geminiAnalysis.potentialRoles,
                    projectInsights: geminiAnalysis.projectInsights, // Use Gemini's analyzed projects
                    identifiedTechnologies: geminiAnalysis.identifiedTechnologies,
                    architecturalConcepts: geminiAnalysis.architecturalConcepts,
                    estimatedExperience: geminiAnalysis.estimatedExperience,
                    // Include factual data alongside AI analysis
                    languageStats: languagePercentages,
                    repoCount: validRepoDetails.length,
                     // Optionally add the raw combined summaries if FE needs it
                    _rawCombinedSummaries: combinedTextFromSummaries
                }
                : { // Fallback to original structure if Gemini failed
                    analysisStatus: 'failed',
                    languageStats: languagePercentages,
                    combinedText: combinedTextFromSummaries, // Use the original combined summary text
                    repoCount: validRepoDetails.length,
                    // Use the original basic repo structure
                    repos: validRepoDetails.map(repo => ({
                        name: repo.name,
                        description: repo.description,
                        languages: repo.languages
                    })),
                    // Add placeholders for fields the frontend might expect
                    headline: "Profile Analysis Unavailable",
                    coFounderSummary: "AI analysis could not be performed.",
                    keyStrengths: [],
                    potentialRoles: [],
                    projectInsights: [],
                    identifiedTechnologies: Object.keys(languagePercentages), // Basic fallback
                    architecturalConcepts: [],
                    estimatedExperience: "N/A"
                }
        };

        return structuredProfile;

    } catch (error) {
        console.error('Error generating user profile:', error);
        // Ensure error is thrown so the controller can catch it
        throw error;
    }
};