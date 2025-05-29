const profileService = require('../services/profileService');
const databaseService = require('../services/databaseService');

exports.generateProfile = async (req, res) => {
try {
// FIXED: userId instead of userld
const { userId, accessToken } = req.user;

// Get current generation count and saved profile status
const generationCount = await databaseService.getGenerationCount(userId);
const savedProfile = await databaseService.getUserProfile(userId);

// Enhanced logic: If no saved profile exists, user should have at least 1 attempt
const effectiveLimit = savedProfile ? 3 : 2; // If no saved profile, limit is 2 (allowing 1 more generation)

if (generationCount >= effectiveLimit) {
const message = savedProfile
? 'You have reached the maximum of 3 profile generations. Delete your saved profile to get 1 attempt back.'
: 'You have reached the generation limit. Save a profile to continue using the service.';

return res.status(403).json({
error: 'Generation limit reached',
message
});
}

// Generate profile
const structuredProfile = await profileService.generateStructuredProfile(accessToken);

// Increment generation count
await databaseService.incrementGenerationCount(userId);
const newCount = generationCount + 1;

// Auto-save on 3rd generation OR if this is the last allowed attempt without saved profile
let autoSaved = false;
const shouldAutoSave = newCount === 3 || (!savedProfile && newCount === effectiveLimit);

if (shouldAutoSave) {
await databaseService.saveUserProfile(userId, structuredProfile);
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
};

exports.saveProfile = async (req, res) => {
try {
// FIXED: userId instead of userld
const { userId } = req.user;
const { profileData } = req.body;

if (!profileData) {
return res.status(400).json({ error: 'Profile data is required' });
}

// FIXED: userId instead of userld in function call
await databaseService.saveUserProfile(userId, profileData);

res.json({
success: true,
message: 'Profile saved successfully'
});

} catch (err) {
console.error('Save profile error:', err);
res.status(500).json({ error: 'Failed to save profile' });
}
};

exports.getSavedProfile = async (req, res) => {
try {
// FIXED: userId instead of userld
const { userId } = req.user;
const savedProfile = await databaseService.getUserProfile(userId);

if (!savedProfile) {
return res.status(404).json({ error: 'No saved profile found' });
}

res.json({ profile: savedProfile.profile_data });

} catch (err) {
console.error('Get saved profile error:', err);
res.status(500).json({ error: 'Failed to get saved profile' });
}
};

exports.deleteProfile = async (req, res) => {
try {
// FIXED: userId instead of userld
const { userId } = req.user;

// Check if user has a saved profile
const savedProfile = await databaseService.getUserProfile(userId);
if (!savedProfile) {
return res.status(404).json({ error: 'No saved profile found to delete' });
}

// Delete the saved profile
await databaseService.deleteUserProfile(userId);

// Decrease generation count by 1 (give back one attempt)
await databaseService.decrementGenerationCount(userId);

res.json({
success: true,
message: 'Profile deleted successfully. You have gained 1 generation attempt back.'
});

} catch (err) {
console.error('Delete profile error:', err);
res.status(500).json({ error: 'Failed to delete profile' });
}
};

exports.getUserPublicProfile = async (req, res) => {
    try {
        const userIdToView = parseInt(req.params.userId, 10); // Get user ID from URL parameter
        if (isNaN(userIdToView)) {
            return res.status(400).json({ error: 'Invalid user ID format.' });
        }

        // Fetch the user's basic info (username, avatar)
        const userBasicInfo = await databaseService.getUserById(userIdToView);
        if (!userBasicInfo) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Fetch the user's saved profile data
        const userProfileRow = await databaseService.getUserProfile(userIdToView); // This gets the {id, user_id, profile_data} row
        
        if (!userProfileRow || !userProfileRow.profile_data) {
            // If the user exists but hasn't saved a profile, you might return basic info or a specific message
            return res.status(404).json({ 
                error: 'This user has not created a co-founder profile yet.',
                user: { // Send basic info
                    github_username: userBasicInfo.github_username,
                    github_avatar_url: userBasicInfo.github_avatar_url
                }
            });
        }

        // Return the profile_data part, similar to getSavedProfile, but also include basic user info
        res.json({
            user: { // Basic info about the profile owner
                user_id: userBasicInfo.id,
                github_username: userBasicInfo.github_username,
                github_avatar_url: userBasicInfo.github_avatar_url,
                github_profile_url: userBasicInfo.github_profile_url
            },
            profile: userProfileRow.profile_data // The actual co-founder profile content
        });

    } catch (err) {
        console.error('Get user public profile error:', err);
        res.status(500).json({ error: 'Failed to get user profile' });
    }
};