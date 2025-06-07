// controllers/profileController.js

// Keep your dependency on profileService, as it doesn't cause a circular issue.
const profileService = require('../services/profileService');

// REMOVED: const databaseService = require('../services/databaseService');

// The entire module is now a factory function that accepts the 'db' instance.
module.exports = (db) => ({

    generateProfile: async (req, res) => {
        try {
            const { userId, accessToken } = req.user;

            // Get current generation count and saved profile status from the injected db object
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

            // Use the injected db object to increment the count
            await db.incrementGenerationCount(userId);
            const newCount = generationCount + 1;

            let autoSaved = false;
            const shouldAutoSave = newCount === 3 || (!savedProfile && newCount === effectiveLimit);

            if (shouldAutoSave) {
                // Use the injected db object to save the profile
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

            // Use the injected db object to save the profile
            await db.saveUserProfile(userId, profileData);

            res.json({
                success: true,
                message: 'Profile saved successfully'
            });

        } catch (err) {
            console.error('Save profile error:', err);
            res.status(500).json({ error: 'Failed to save profile' });
        }
    },

    getSavedProfile: async (req, res) => {
        try {
            const { userId } = req.user;
            // Use the injected db object to get the profile
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

            // Use the injected db object for all database operations
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

            // Use the injected db object for all database operations
            const userBasicInfo = await db.getUserById(userIdToView);
            if (!userBasicInfo) {
                return res.status(404).json({ error: 'User not found.' });
            }

            const userProfileRow = await db.getUserProfile(userIdToView);

            if (!userProfileRow || !userProfileRow.profile_data) {
                return res.status(404).json({
                    error: 'This user has not created a co-founder profile yet.',
                    user: {
                        github_username: userBasicInfo.github_username,
                        github_avatar_url: userBasicInfo.github_avatar_url
                    }
                });
            }

            res.json({
                user: {
                    user_id: userBasicInfo.id,
                    github_username: userBasicInfo.github_username,
                    github_avatar_url: userBasicInfo.github_avatar_url,
                    github_profile_url: userBasicInfo.github_profile_url
                },
                profile: userProfileRow.profile_data
            });

        } catch (err) {
            console.error('Get user public profile error:', err);
            res.status(500).json({ error: 'Failed to get user profile' });
        }
    }
});
