// controllers/suggestionController.js

// Helper function to calculate Jaccard Index for array similarity
function calculateJaccardIndex(arr1, arr2) {
    if (!arr1 || !arr2 || arr1.length === 0 || arr2.length === 0) return 0;
    const set1 = new Set(arr1.map(item => String(item).toLowerCase().trim()));
    const set2 = new Set(arr2.map(item => String(item).toLowerCase().trim()));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

// Helper function to calculate language statistics similarity
function calculateLanguageStatsSimilarity(stats1, stats2) {
    if (!stats1 || !stats2) return 0;
    
    const allLanguages = new Set([...Object.keys(stats1), ...Object.keys(stats2)]);
    let totalDifference = 0;
    let maxPossibleDifference = 0;
    
    for (const lang of allLanguages) {
        const percent1 = parseFloat(stats1[lang] || 0);
        const percent2 = parseFloat(stats2[lang] || 0);
        const difference = Math.abs(percent1 - percent2);
        totalDifference += difference;
        maxPossibleDifference += Math.max(percent1, percent2);
    }
    
    if (maxPossibleDifference === 0) return 0;
    return 1 - (totalDifference / (maxPossibleDifference * 2));
}

// Helper function to calculate experience level compatibility
function calculateExperienceLevelSimilarity(exp1, exp2) {
    const experienceLevels = {
        'junior': 1,
        'entry': 1,
        'mid': 2,
        'intermediate': 2,
        'senior': 3,
        'lead': 4,
        'principal': 4,
        'staff': 4,
        'expert': 5,
        'n/a': 0
    };
    
    const getExperienceLevel = (exp) => {
        if (!exp || typeof exp !== 'string') return 0;
        const expLower = exp.toLowerCase();
        for (const [key, level] of Object.entries(experienceLevels)) {
            if (expLower.includes(key)) return level;
        }
        return 0;
    };
    
    const level1 = getExperienceLevel(exp1);
    const level2 = getExperienceLevel(exp2);
    
    if (level1 === 0 || level2 === 0) return 0.5; // Neutral if unknown
    
    const difference = Math.abs(level1 - level2);
    const maxDifference = 4; // Max difference between junior and expert
    
    return 1 - (difference / maxDifference);
}

// Helper function to calculate repository activity similarity
function calculateRepoActivitySimilarity(repoCount1, repoCount2) {
    if (!repoCount1 || !repoCount2) return 0;
    
    const minCount = Math.min(repoCount1, repoCount2);
    const maxCount = Math.max(repoCount1, repoCount2);
    
    if (maxCount === 0) return 1; // Both have no repos
    
    return minCount / maxCount;
}

// Helper function to calculate text similarity using basic keyword matching
function calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const getKeywords = (text) => {
        const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'this', 'that', 'these', 'those']);
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !commonWords.has(word))
            .slice(0, 50); // Limit to avoid performance issues
    };
    
    const keywords1 = getKeywords(text1);
    const keywords2 = getKeywords(text2);
    
    return calculateJaccardIndex(keywords1, keywords2);
}

// Main matching algorithm with comprehensive scoring
function calculateDetailedMatchScore(currentProfile, matchProfile) {
    const scores = {};
    let totalWeight = 0;
    
    // 1. Technical Skills Similarity (Weight: 25%)
    const skillsScore = calculateJaccardIndex(
        currentProfile.keyStrengths || [],
        matchProfile.keyStrengths || []
    );
    scores.technicalSkills = skillsScore;
    totalWeight += 0.25;
    
    // 2. Technology Stack Similarity (Weight: 20%)
    const techScore = calculateJaccardIndex(
        currentProfile.identifiedTechnologies || [],
        matchProfile.identifiedTechnologies || []
    );
    scores.technologyStack = techScore;
    totalWeight += 0.20;
    
    // 3. Programming Language Similarity (Weight: 15%)
    const langScore = calculateLanguageStatsSimilarity(
        currentProfile.languageStats || {},
        matchProfile.languageStats || {}
    );
    scores.programmingLanguages = langScore;
    totalWeight += 0.15;
    
    // 4. Role Compatibility (Weight: 15%)
    const roleScore = calculateJaccardIndex(
        currentProfile.potentialRoles || [],
        matchProfile.potentialRoles || []
    );
    scores.roleCompatibility = roleScore;
    totalWeight += 0.15;
    
    // 5. Architectural Concepts Similarity (Weight: 10%)
    const archScore = calculateJaccardIndex(
        currentProfile.architecturalConcepts || [],
        matchProfile.architecturalConcepts || []
    );
    scores.architecturalConcepts = archScore;
    totalWeight += 0.10;
    
    // 6. Experience Level Compatibility (Weight: 10%)
    const expScore = calculateExperienceLevelSimilarity(
        currentProfile.estimatedExperience,
        matchProfile.estimatedExperience
    );
    scores.experienceLevel = expScore;
    totalWeight += 0.10;
    
    // 7. Repository Activity Similarity (Weight: 3%)
    const repoScore = calculateRepoActivitySimilarity(
        currentProfile.repoCount,
        matchProfile.repoCount
    );
    scores.repositoryActivity = repoScore;
    totalWeight += 0.03;
    
    // 8. Project Insights Similarity (Weight: 2%)
    const projectInsightsText1 = (currentProfile.projectInsights || []).join(' ');
    const projectInsightsText2 = (matchProfile.projectInsights || []).join(' ');
    const projectScore = calculateTextSimilarity(projectInsightsText1, projectInsightsText2);
    scores.projectInsights = projectScore;
    totalWeight += 0.02;
    
    // Calculate weighted final score
    const finalScore = (
        scores.technicalSkills * 0.25 +
        scores.technologyStack * 0.20 +
        scores.programmingLanguages * 0.15 +
        scores.roleCompatibility * 0.15 +
        scores.architecturalConcepts * 0.10 +
        scores.experienceLevel * 0.10 +
        scores.repositoryActivity * 0.03 +
        scores.projectInsights * 0.02
    ) / totalWeight;
    
    return {
        finalScore: Math.max(0, Math.min(1, finalScore)), // Ensure score is between 0 and 1
        breakdown: scores
    };
}

// The entire module is now a factory function that accepts the 'db' instance.
module.exports = (db) => ({
    getSuggestions: async (req, res) => {
        const currentUserId = req.user.userId;
        
        try {
            // 1. Get the current user's saved profile using the injected 'db' object
            const currentUserProfileRow = await db.getUserProfile(currentUserId);
            if (!currentUserProfileRow || !currentUserProfileRow.profile_data) {
                return res.json({ 
                    suggestions: [], 
                    message: "Please save your profile to get suggestions." 
                });
            }
            const currentUserProfile = currentUserProfileRow.profile_data.technical;
            
            // 2. Get all other users with saved profiles using the injected 'db' object
            const allUsersWithProfilesResult = await db.query(
                `SELECT u.id as user_id, u.github_username, u.github_avatar_url, u.github_profile_url, sp.profile_data
                 FROM users u
                 JOIN saved_profiles sp ON u.id = sp.user_id
                 WHERE u.id != $1 AND sp.profile_data IS NOT NULL;`,
                [currentUserId]
            );
            const potentialMatches = allUsersWithProfilesResult.rows;
            
            // 3. Get existing connections/requests using the injected 'db' object
            const activeConnections = await db.getActiveConnections(currentUserId);
            const pendingSentRequests = await db.getSentRequestsByUser(currentUserId);
            const pendingReceivedRequests = await db.getPendingRequestsForUser(currentUserId);
            
            const existingInteractionUserIds = new Set();
            activeConnections.forEach(c => existingInteractionUserIds.add(c.id));
            pendingSentRequests.forEach(r => existingInteractionUserIds.add(r.addressee_id));
            pendingReceivedRequests.forEach(r => existingInteractionUserIds.add(r.requester_id));
            
            // 4. Calculate detailed scores and filter
            const suggestions = [];
            const minScoreThreshold = 0.15; // 15% minimum match score
            
            for (const potentialMatch of potentialMatches) {
                if (existingInteractionUserIds.has(potentialMatch.user_id)) {
                    continue;
                }
                
                const matchProfile = potentialMatch.profile_data;
                if (!matchProfile || !matchProfile.technical || matchProfile.technical.analysisStatus === 'failed') {
                    continue;
                }
                
                const matchTechnical = matchProfile.technical;
                const scoreResult = calculateDetailedMatchScore(currentUserProfile, matchTechnical);
                
                if (scoreResult.finalScore >= minScoreThreshold) {
                    // Determine match strength category
                    let matchStrength = 'Low';
                    if (scoreResult.finalScore >= 0.7) matchStrength = 'Excellent';
                    else if (scoreResult.finalScore >= 0.5) matchStrength = 'High';
                    else if (scoreResult.finalScore >= 0.3) matchStrength = 'Medium';
                    
                    // Find top matching areas
                    const topMatchingAreas = Object.entries(scoreResult.breakdown)
                        .sort(([,a], [,b]) => b - a)
                        .slice(0, 3)
                        .map(([area, score]) => ({
                            area: area.replace(/([A-Z])/g, ' $1').trim(),
                            score: Math.round(score * 100)
                        }));
                    
                    suggestions.push({
                        user_id: potentialMatch.user_id,
                        github_username: potentialMatch.github_username,
                        github_avatar_url: potentialMatch.github_avatar_url,
                        github_profile_url: potentialMatch.github_profile_url,
                        headline: matchTechnical.headline || "No headline available",
                        keyStrengths: (matchTechnical.keyStrengths || []).slice(0, 3),
                        potentialRoles: (matchTechnical.potentialRoles || []).slice(0, 2),
                        matchScore: Math.round(scoreResult.finalScore * 100), // Convert to percentage
                        matchStrength: matchStrength,
                        topMatchingAreas: topMatchingAreas,
                        commonTechnologies: (currentUserProfile.identifiedTechnologies || [])
                            .filter(tech => (matchTechnical.identifiedTechnologies || [])
                                .map(t => t.toLowerCase())
                                .includes(tech.toLowerCase()))
                            .slice(0, 5),
                        estimatedExperience: matchTechnical.estimatedExperience || "N/A",
                        scoreBreakdown: Object.fromEntries(
                            Object.entries(scoreResult.breakdown).map(([key, value]) => 
                                [key, Math.round(value * 100)]
                            )
                        )
                    });
                }
            }
            
            // 5. Sort by match score (descending) and limit
            suggestions.sort((a, b) => b.matchScore - a.matchScore);
            const topSuggestions = suggestions.slice(0, 20);
            
            // 6. Add statistics
            const stats = {
                totalCandidates: potentialMatches.length,
                qualifiedMatches: suggestions.length,
                averageMatchScore: suggestions.length > 0 
                    ? Math.round(suggestions.reduce((sum, s) => sum + s.matchScore, 0) / suggestions.length)
                    : 0,
                topSuggestions: topSuggestions.length
            };
            
            res.json({ 
                suggestions: topSuggestions,
                stats: stats,
                message: topSuggestions.length === 0 
                    ? "No suitable matches found. Try updating your profile with more technologies and skills."
                    : `Found ${topSuggestions.length} potential matches based on your profile.`
            });
            
        } catch (error) {
            console.error("Error getting suggestions:", error);
            res.status(500).json({ error: "Failed to get suggestions" });
        }
    },
    
    // Export helper functions for testing
    calculateJaccardIndex,
    calculateDetailedMatchScore
});
