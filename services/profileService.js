// services/profileService.js
const githubService     = require('./githubService');
const summarizerService = require('./summarizerService');
const { parseProfile }  = require('./groqService');

async function fetchAndSummarize(accessToken) {
  const userData  = await githubService.getUserData(accessToken);
  const reposData = await githubService.getUserRepos(accessToken);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const filtered = reposData.filter(r => !r.fork && new Date(r.updated_at) >= cutoff);

  const details = await Promise.all(filtered.map(async r => {
    try {
      const [readme, languages] = await Promise.all([
        githubService.getRepoReadme(accessToken, r.owner.login, r.name),
        githubService.getRepoLanguages(accessToken, r.owner.login, r.name)
      ]);
      return {
        name:        r.name,
        description: r.description || '',
        readme:      readme || '',
        languages:   languages || {},
        updated_at:  r.updated_at
      };
    } catch {
      return null;
    }
  }));
  const validRepos = details.filter(d => d);

  const agg = {};
  validRepos.forEach(r => {
    Object.entries(r.languages).forEach(([lang, bytes]) => {
      agg[lang] = (agg[lang]||0) + bytes;
    });
  });
  const total = Object.values(agg).reduce((s,b) => s + b, 0);
  const languageStats = Object.fromEntries(
    Object.entries(agg).map(([lang,bytes]) => [
      lang,
      total > 0 ? ((bytes/total)*100).toFixed(2) : '0.00'
    ])
  );

  const opts = { max_length:150, min_length:50, chunkSize:2000 };
  const repoSummaries = await Promise.all(
    validRepos.map(async r => {
      const txt = `${r.description} ${r.readme}`.trim();
      if (!txt) return `${r.name}: No detailed content available.`;
      const sum = await summarizerService.summarizeText(txt, opts);
      return `${r.name}: ${sum}`;
    })
  );
  const combinedTextFromSummaries = repoSummaries.join('\n\n');

  return {
    personal: {
      login:      userData.login,
      name:       userData.name,
      bio:        userData.bio,
      avatar_url: userData.avatar_url,
      html_url:   userData.html_url
    },
    technical: {
      languageStats,
      combinedTextFromSummaries,
      repoCount: validRepos.length,
      repos: validRepos.map(r => ({
        name:        r.name,
        description: r.description,
        languages:   r.languages,
        updated_at:  r.updated_at
      }))
    }
  };
}

async function generateStructuredProfile(accessToken) {
  try {
    const { personal, technical } = await fetchAndSummarize(accessToken);
    const groqAnalysis = await parseProfile(
      technical.combinedTextFromSummaries,
      technical.languageStats,
      technical.repos
    );
    return {
      personal,
      technical: {
        analysisStatus:         'success',
        headline:               groqAnalysis.headline,
        coFounderSummary:       groqAnalysis.coFounderSummary,
        keyStrengths:           groqAnalysis.keyStrengths,
        potentialRoles:         groqAnalysis.potentialRoles,
        projectInsights:        groqAnalysis.projectInsights,
        identifiedTechnologies: groqAnalysis.identifiedTechnologies,
        architecturalConcepts:  groqAnalysis.architecturalConcepts,
        estimatedExperience:    groqAnalysis.estimatedExperience,
        languageStats:          technical.languageStats,
        repoCount:              technical.repoCount,
        _rawCombinedSummaries:  technical.combinedTextFromSummaries
      }
    };
  } catch (err) {
    console.warn('Profile generation failed, falling back:', err.message);
    const { personal, technical } = await fetchAndSummarize(accessToken);
    return {
      personal,
      technical: {
        analysisStatus:        'failed',
        languageStats:         technical.languageStats,
        combinedText:          technical.combinedTextFromSummaries,
        repoCount:             technical.repoCount,
        repos:                 technical.repos,
        headline:              "Profile Analysis Unavailable",
        coFounderSummary:      "AI analysis could not be performed.",
        keyStrengths:          [],
        potentialRoles:        [],
        projectInsights:       [],
        identifiedTechnologies: Object.keys(technical.languageStats),
        architecturalConcepts: [],
        estimatedExperience:   "N/A"
      }
    };
  }
}

module.exports = { generateStructuredProfile };
