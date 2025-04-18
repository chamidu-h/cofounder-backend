const githubService = require('./githubService');
const summarizerService = require('./summarizerService');
const geminiService = require('./geminiService');

// Helper function to truncate long text
const truncateText = (text, maxLength = 8000) => {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
};

exports.generateUserProfile = async (accessToken) => {
  try {
    // Step 1: Fetch user and repo data
    const userData = await githubService.getUserData(accessToken);
    const reposData = await githubService.getUserRepos(accessToken);

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const filteredRepos = reposData.filter(repo => {
      const updatedAt = new Date(repo.updated_at);
      return !repo.fork && updatedAt >= twelveMonthsAgo;
    });

    // Step 2: Gather repo details, including heuristic codebase fallback
    const repoDetailsPromises = filteredRepos.map(async (repo) => {
      try {
        const owner = repo.owner.login;
        const repoName = repo.name;
        const [readme, languages] = await Promise.all([
          githubService.getRepoReadme(accessToken, owner, repoName),
          githubService.getRepoLanguages(accessToken, owner, repoName)
        ]);
        const description = repo.description || '';

        // If no description and no readme, fetch crucial files for Gemini
        let codebaseContext = '';
        if (!description && !readme) {
          const crucialFiles = await githubService.getCrucialFiles(accessToken, owner, repoName);
          const codeSnippets = [];
          for (const file of crucialFiles) {
            const content = await githubService.getFileContent(accessToken, owner, repoName, file.path || file.name);
            if (content) {
              codeSnippets.push(`// File: ${file.path || file.name}\n${truncateText(content, 4000)}`);
            }
          }
          if (codeSnippets.length) {
            codebaseContext = codeSnippets.join('\n\n');
            console.log(`[DEBUG] Codebase context for ${repoName}:\n${codebaseContext.substring(0, 300)}...`);
          }
        }

        return {
          name: repo.name,
          description,
          readme: readme || '',
          languages: languages || {},
          pushed_at: repo.pushed_at,
          stargazers_count: repo.stargazers_count,
          html_url: repo.html_url,
          codebaseContext // Add codebase context for Gemini if needed
        };
      } catch (innerError) {
        console.error(`Error processing repository ${repo.name}:`, innerError);
        return null;
      }
    });

    const repoDetails = await Promise.all(repoDetailsPromises);
    const validRepoDetails = repoDetails.filter(detail => detail !== null);

    // Step 3: Aggregate language statistics
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

    // Step 4: Summarize each repository (with codebase fallback)
    const summarizationOptions = { max_length: 150, min_length: 30 };
    const repoSummariesMap = {};
    const repoSummariesPromises = validRepoDetails.map(async (repo) => {
      let textToSummarize = `${repo.description} ${truncateText(repo.readme, 8000)}`.trim();
      // If no description/readme, use codebase context for summarization
      if (!textToSummarize && repo.codebaseContext) {
        textToSummarize = repo.codebaseContext;
      }
      let repoSummaryResult = `${repo.name}: No detailed content available.`;
      if (textToSummarize) {
        // Use Gemini for codebase context, otherwise fallback to HuggingFace summarizer
        let summary;
        if (!repo.description && !repo.readme && repo.codebaseContext) {
          // Use Gemini to summarize codebase context
          try {
            const geminiPrompt = `
You are an expert software analyst. Based on the following code files and configuration, summarize the main domain, purpose, technologies, and application type of this GitHub repository. Be concise and professional.

${repo.codebaseContext}
`;
            const geminiResult = await geminiService.analyzeProfileData({ code: repo.codebaseContext, repoName: repo.name, prompt: geminiPrompt });
            summary = (geminiResult && typeof geminiResult === 'object' && geminiResult.summary)
              ? geminiResult.summary
              : (typeof geminiResult === 'string' ? geminiResult : "Summary not generated.");
          } catch (e) {
            summary = "Summary not generated.";
          }
        } else {
          summary = await summarizerService.summarizeText(textToSummarize, summarizationOptions);
        }
        repoSummariesMap[repo.name] = (summary && summary !== textToSummarize) ? summary : repo.description || "Summary not generated.";
        repoSummaryResult = `${repo.name}: ${repoSummariesMap[repo.name]}`;
      } else {
        repoSummariesMap[repo.name] = "No detailed content available.";
      }
      return repoSummaryResult;
    });

    const repoSummariesArray = await Promise.all(repoSummariesPromises);
    const combinedTextFromSummaries = repoSummariesArray.join('\n\n');

    // Step 5: Prepare data and call Gemini for overall profile analysis
    let geminiAnalysis = null;
    const dataForGemini = {
      personal: {
        login: userData.login,
        name: userData.name,
        bio: userData.bio || '',
      },
      technical: {
        languageStats: languagePercentages,
        repoCount: validRepoDetails.length,
        repos: validRepoDetails.map(repo => ({
          name: repo.name,
          description: repo.description,
          summary: repoSummariesMap[repo.name] || "N/A",
          languages: repo.languages,
          pushed_at: repo.pushed_at,
          stargazers_count: repo.stargazers_count,
          html_url: repo.html_url
        })),
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
    }

    // Step 6: Construct final profile (structure unchanged)
    const structuredProfile = {
      personal: {
        login: userData.login,
        name: userData.name,
        bio: userData.bio,
        avatar_url: userData.avatar_url,
        html_url: userData.html_url,
      },
      technical: geminiAnalysis
        ? {
            analysisStatus: 'success',
            headline: geminiAnalysis.headline,
            coFounderSummary: geminiAnalysis.coFounderSummary,
            keyStrengths: geminiAnalysis.keyStrengths,
            potentialRoles: geminiAnalysis.potentialRoles,
            projectInsights: geminiAnalysis.projectInsights,
            identifiedTechnologies: geminiAnalysis.identifiedTechnologies,
            architecturalConcepts: geminiAnalysis.architecturalConcepts,
            estimatedExperience: geminiAnalysis.estimatedExperience,
            languageStats: languagePercentages,
            repoCount: validRepoDetails.length,
            _rawCombinedSummaries: combinedTextFromSummaries
          }
        : {
            analysisStatus: 'failed',
            languageStats: languagePercentages,
            combinedText: combinedTextFromSummaries,
            repoCount: validRepoDetails.length,
            repos: validRepoDetails.map(repo => ({
              name: repo.name,
              description: repo.description,
              languages: repo.languages
            })),
            headline: "Profile Analysis Unavailable",
            coFounderSummary: "AI analysis could not be performed.",
            keyStrengths: [],
            potentialRoles: [],
            projectInsights: [],
            identifiedTechnologies: Object.keys(languagePercentages),
            architecturalConcepts: [],
            estimatedExperience: "N/A"
          }
    };

    return structuredProfile;

  } catch (error) {
    console.error('Error generating user profile:', error);
    throw error;
  }
};
