// services/profileService.js
const githubService = require('./githubService');
const summarizerService = require('./summarizerService');

exports.generateUserProfile = async (accessToken) => {
  try {
    // Fetch basic user data and repositories from GitHub.
    const userData = await githubService.getUserData(accessToken);
    const reposData = await githubService.getUserRepos(accessToken);
    
    // Calculate the date 12 months ago.
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    // Filter repositories:
    // - Exclude forked repositories.
    // - Only include repositories updated within the last 12 months.
    const filteredRepos = reposData.filter(repo => {
      const updatedAt = new Date(repo.updated_at);
      return !repo.fork && updatedAt >= twelveMonthsAgo;
    });

    // Process each repository: fetch additional details.
    const repoDetailsPromises = filteredRepos.map(async (repo) => {
      try {
        const owner = repo.owner.login;
        const repoName = repo.name;
        // Fetch README and languages concurrently.
        const [readme, languages] = await Promise.all([
          githubService.getRepoReadme(accessToken, owner, repoName),
          githubService.getRepoLanguages(accessToken, owner, repoName)
        ]);
        const description = repo.description || '';
        return {
          name: repo.name,
          description,
          readme: readme || '',
          languages: languages || {}
        };
      } catch (innerError) {
        console.error(`Error processing repository ${repo.name}:`, innerError);
        return null;
      }
    });

    const repoDetails = await Promise.all(repoDetailsPromises);
    const validRepoDetails = repoDetails.filter(detail => detail !== null);

    // Aggregate language statistics across repositories.
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

    // Summarize each repository's content individually to retain uniqueness.
    const summarizationOptions = { max_length: 150, min_length: 50, chunkSize: 2000 };
    const repoSummariesPromises = validRepoDetails.map(async (repo) => {
      const repoCombinedText = `${repo.description} ${repo.readme}`.trim();
      if (!repoCombinedText) {
        return `${repo.name}: No detailed content available.`;
      }
      // Summarize the repository-specific text.
      const repoSummary = await summarizerService.summarizeText(repoCombinedText, summarizationOptions);
      return `${repo.name}: ${repoSummary}`;
    });
    const repoSummaries = await Promise.all(repoSummariesPromises);

    // Combine repository summaries into a final aggregated technical summary.
    // Here we list each repo summary on a new line.
    const finalSummary = repoSummaries.join('\n\n');

    const structuredProfile = {
      personal: {
        login: userData.login,
        name: userData.name,
        bio: userData.bio,
        avatar_url: userData.avatar_url,
        html_url: userData.html_url,
      },
      technical: {
        languageStats: languagePercentages,
        combinedText: finalSummary, // Aggregated repo-specific summaries.
        repoCount: validRepoDetails.length,
        repos: validRepoDetails.map(repo => ({
          name: repo.name,
          description: repo.description,
          languages: repo.languages
        }))
      }
    };

    return structuredProfile;
  } catch (error) {
    console.error('Error generating user profile:', error);
    throw error;
  }
};
