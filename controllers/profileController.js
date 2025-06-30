const profileService = require('../services/profileService');

// The entire module is now a factory function that accepts the 'db' instance.
module.exports = (db) => ({

    generateProfile: async (req, res) => {
        try {
            const { userId, accessToken } = req.user;
            const generationCount = await db.getGenerationCount(userId);
            const savedProfile = await db.getUserProfile(userId);
            const effectiveLimit = savedProfile ? 3 : 2;

            if (generationCount >= effectiveLimit) {
                const message = savedProfile
                    ? 'You have reached the maximum of 3 profile generations. Delete your saved profile to get 1 attempt back.'
                    : 'You have reached the generation limit. Save a profile to continue using the service.';
                return res.status(403).json({ error: 'Generation limit reached', message });
            }

            const structuredProfile = await profileService.generateStructuredProfile(accessToken);
            await db.incrementGenerationCount(userId);
            const newCount = generationCount + 1;

            let autoSaved = false;
            const shouldAutoSave = newCount === 3 || (!savedProfile && newCount === effectiveLimit);

            if (shouldAutoSave) {
                await db.saveUserProfile(userId, structuredProfile);
                autoSaved = true;
            }

            res.json({
                profile: structuredProfile,
                generationCount: newCount,
                canGenerate: newCount < (savedProfile || autoSaved ? 3 : 2),
                autoSaved,
                message: autoSaved ? 'Profile has been automatically saved!' : null
            });

        } catch (err) {
            console.error('Profile generation error:', err);
            res.status(500).json({ error: 'Failed to generate profile' });
        }
    },

    saveProfile: async (req, res) => {
        try {
            const { userId } = req.user;
            const { profileData } = req.body;

            if (!profileData) {
                return res.status(400).json({ error: 'Profile data is required' });
            }

            await db.saveUserProfile(userId, profileData);
            res.json({ success: true, message: 'Profile saved successfully' });

        } catch (err) {
            console.error('Save profile error:', err);
            res.status(500).json({ error: 'Failed to save profile' });
        }
    },

    getSavedProfile: async (req, res) => {
        try {
            const { userId } = req.user;
            const savedProfile = await db.getUserProfile(userId);

            if (!savedProfile) {
                return res.status(404).json({ error: 'No saved profile found' });
            }

            res.json({ profile: savedProfile.profile_data });

        } catch (err) {
            console.error('Get saved profile error:', err);
            res.status(500).json({ error: 'Failed to get saved profile' });
        }
    },

    deleteProfile: async (req, res) => {
        try {
            const { userId } = req.user;
            const savedProfile = await db.getUserProfile(userId);
            if (!savedProfile) {
                return res.status(404).json({ error: 'No saved profile found to delete' });
            }

            await db.deleteUserProfile(userId);
            await db.decrementGenerationCount(userId);

            res.json({
                success: true,
                message: 'Profile deleted successfully. You have gained 1 generation attempt back.'
            });

        } catch (err) {
            console.error('Delete profile error:', err);
            res.status(500).json({ error: 'Failed to delete profile' });
        }
    },

    getUserPublicProfile: async (req, res) => {
        try {
            const userIdToView = parseInt(req.params.userId, 10);
            if (isNaN(userIdToView)) {
                return res.status(400).json({ error: 'Invalid user ID format.' });
            }

            const userBasicInfo = await db.getUserById(userIdToView);
            if (!userBasicInfo) {
                return res.status(404).json({ error: 'User not found.' });
            }

            const userProfileRow = await db.getUserProfile(userIdToView);

            // FIXED: Consistent response structure using 'id' property
            // This eliminates the data inconsistency that caused the frontend bug
            const userResponse = {
                id: userBasicInfo.id, // Consistent 'id' property
                github_username: userBasicInfo.github_username,
                github_avatar_url: userBasicInfo.github_avatar_url,
                github_profile_url: userBasicInfo.github_profile_url
            };

            // Handle case where user exists but has no profile
            if (!userProfileRow || !userProfileRow.profile_data) {
                return res.json({
                    user: userResponse,
                    profile: null 
                });
            }

            // Return user with profile data
            res.json({
                user: userResponse,
                profile: userProfileRow.profile_data
            });

        } catch (err) {
            console.error('Get user public profile error:', err);
            res.status(500).json({ error: 'Failed to get user profile' });
        }
    }
});
