// controllers/suggestionController.js
const databaseService = require('../services/databaseService');

// Helper function to calculate Jaccard Index for array similarity
function calculateJaccardIndex(arr1, arr2) {
    if (!arr1 || !arr2 || arr1.length === 0 || arr2.length === 0) return 0;
    const set1 = new Set(arr1.map(item => String(item).toLowerCase().trim())); // Ensure items are strings
    const set2 = new Set(arr2.map(item => String(item).toLowerCase().trim())); // Ensure items are strings
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size; // Avoid division by zero
}

exports.getSuggestions = async (req, res) => {
    const currentUserId = req.user.userId; // From JWT auth middleware

    try {
        // 1. Get the current user's saved profile
        const currentUserProfileRow = await databaseService.getUserProfile(currentUserId);
        if (!currentUserProfileRow || !currentUserProfileRow.profile_data) {
            return res.json({ suggestions: [], message: "Please save your profile to get suggestions." });
        }
        const currentUserProfile = currentUserProfileRow.profile_data;
        const currentUserStrengths = currentUserProfile.technical?.keyStrengths || [];
        const currentUserTechs = currentUserProfile.technical?.identifiedTechnologies || [];

        // 2. Get all other users with saved profiles
        const allUsersWithProfilesResult = await databaseService.query(
            `SELECT u.id as user_id, u.github_username, u.github_avatar_url, u.github_profile_url, sp.profile_data
             FROM users u
             JOIN saved_profiles sp ON u.id = sp.user_id
             WHERE u.id != $1;`,
            [currentUserId]
        );
        const potentialMatches = allUsersWithProfilesResult.rows;

        // 3. Get existing connections/requests to filter them out
        const activeConnections = await databaseService.getActiveConnections(currentUserId);
        const pendingSentRequests = await databaseService.getSentRequestsByUser(currentUserId);
        const pendingReceivedRequests = await databaseService.getPendingRequestsForUser(currentUserId);

        const existingInteractionUserIds = new Set();
        activeConnections.forEach(c => existingInteractionUserIds.add(c.id)); // Assuming activeConnections returns user objects with .id
        pendingSentRequests.forEach(r => existingInteractionUserIds.add(r.addressee_id));
        pendingReceivedRequests.forEach(r => existingInteractionUserIds.add(r.requester_id));


        // 4. Calculate scores and filter
        const suggestions = [];
        for (const potentialMatch of potentialMatches) {
            if (existingInteractionUserIds.has(potentialMatch.user_id)) {
                continue; // Skip users already connected or with pending requests
            }

            const matchProfile = potentialMatch.profile_data;
            if (!matchProfile || !matchProfile.technical) { // Ensure match has technical profile data
                continue;
            }
            const matchStrengths = matchProfile.technical.keyStrengths || [];
            const matchTechs = matchProfile.technical.identifiedTechnologies || [];

            let score = 0;
            score += calculateJaccardIndex(currentUserStrengths, matchStrengths) * 0.6; // Weight strengths higher
            score += calculateJaccardIndex(currentUserTechs, matchTechs) * 0.4;

            if (score > 0.05) { // Lowered threshold slightly for more potential MVP results
                suggestions.push({
                    user_id: potentialMatch.user_id,
                    github_username: potentialMatch.github_username,
                    github_avatar_url: potentialMatch.github_avatar_url,
                    github_profile_url: potentialMatch.github_profile_url,
                    headline: matchProfile.technical.headline, 
                    keyStrengths: matchStrengths.slice(0, 3), 
                    score: parseFloat(score.toFixed(4))
                });
            }
        }

        // 5. Sort by score and limit
        suggestions.sort((a, b) => b.score - a.score);
        const topSuggestions = suggestions.slice(0, 10); 

        res.json({ suggestions: topSuggestions });

    } catch (error) {
        console.error("Error getting suggestions:", error);
        res.status(500).json({ error: "Failed to get suggestions" });
    }
};

// Optional: Export helper for testing if needed directly
// exports.calculateJaccardIndex = calculateJaccardIndex;
