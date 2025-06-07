// controllers/suggestionController.js

// REMOVED: const databaseService = require('../services/databaseService');

// Helper function to calculate Jaccard Index for array similarity
// This function doesn't depend on the database, so it can remain at the module level.
function calculateJaccardIndex(arr1, arr2) {
    if (!arr1 || !arr2 || arr1.length === 0 || arr2.length === 0) return 0;
    const set1 = new Set(arr1.map(item => String(item).toLowerCase().trim()));
    const set2 = new Set(arr2.map(item => String(item).toLowerCase().trim()));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

// The entire module is now a factory function that accepts the 'db' instance.
module.exports = (db) => ({

    getSuggestions: async (req, res) => {
        const currentUserId = req.user.userId;

        try {
            // 1. Get the current user's saved profile using the injected 'db' object
            const currentUserProfileRow = await db.getUserProfile(currentUserId);
            if (!currentUserProfileRow || !currentUserProfileRow.profile_data) {
                return res.json({ suggestions: [], message: "Please save your profile to get suggestions." });
            }
            const currentUserProfile = currentUserProfileRow.profile_data;
            const currentUserStrengths = currentUserProfile.technical?.keyStrengths || [];
            const currentUserTechs = currentUserProfile.technical?.identifiedTechnologies || [];

            // 2. Get all other users with saved profiles using the injected 'db' object
            const allUsersWithProfilesResult = await db.query(
                `SELECT u.id as user_id, u.github_username, u.github_avatar_url, u.github_profile_url, sp.profile_data
                 FROM users u
                 JOIN saved_profiles sp ON u.id = sp.user_id
                 WHERE u.id != $1;`,
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

            // 4. Calculate scores and filter
            const suggestions = [];
            for (const potentialMatch of potentialMatches) {
                if (existingInteractionUserIds.has(potentialMatch.user_id)) {
                    continue;
                }

                const matchProfile = potentialMatch.profile_data;
                if (!matchProfile || !matchProfile.technical) {
                    continue;
                }
                const matchStrengths = matchProfile.technical.keyStrengths || [];
                const matchTechs = matchProfile.technical.identifiedTechnologies || [];

                let score = 0;
                score += calculateJaccardIndex(currentUserStrengths, matchStrengths) * 0.6;
                score += calculateJaccardIndex(currentUserTechs, matchTechs) * 0.4;

                if (score > 0.05) {
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
    }
    // You can also export the helper function if you plan to test it separately.
    // getJaccardIndexForTest: calculateJaccardIndex
});
