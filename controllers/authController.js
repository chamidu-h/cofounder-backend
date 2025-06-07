// /controllers/authController.js

// --- MODULE IMPORTS ---
const jwt = require('jsonwebtoken');
const axios = require('axios'); // Import axios at the top for consistency
const databaseService = require('../services/databaseService');

// --- GITHUB AUTHENTICATION REDIRECT ---
// This function initiates the GitHub login process by redirecting the user.
exports.githubAuth = (req, res) => {
    try {
        const includePrivate = req.query.include_private === 'true';
        const baseScope = 'read:user user:email';
        const privateScope = 'repo';
        const scope = includePrivate ? `${baseScope} ${privateScope}` : baseScope;
        
        // Ensure required environment variables are present before generating the URL
        const client_id = process.env.GITHUB_CLIENT_ID;
        const redirect_uri = process.env.GITHUB_REDIRECT_URI;

        if (!client_id || !redirect_uri) {
            console.error('[AUTH_INIT] GITHUB_CLIENT_ID or GITHUB_REDIRECT_URI is not set in the environment.');
            return res.status(500).send('Server configuration error. Cannot initiate GitHub login.');
        }

        const state = 'some_random_state'; // In a real app, generate and validate this state
        
        const authUrl = `https://github.com/login/oauth/authorize?` +
            `client_id=${client_id}` +
            `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
            `&scope=${encodeURIComponent(scope)}` +
            `&state=${state}`;
        
        console.log('[AUTH_INIT] Redirecting user to GitHub for authorization.');
        res.redirect(authUrl);

    } catch (error) {
        console.error('[AUTH_INIT] Error creating GitHub auth URL:', error);
        res.status(500).send('An unexpected error occurred.');
    }
};


// --- GITHUB CALLBACK HANDLER (WITH ENHANCED LOGGING) ---
// This function handles the callback from GitHub after the user authorizes the app.
exports.githubCallback = async (req, res) => {
    const { code } = req.query;
    const FE_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    // 1. Log the initial request from GitHub to see if we received the code
    console.log('[AUTH_CALLBACK] Received callback from GitHub with query:', req.query);

    if (!code) {
        console.error('[AUTH_CALLBACK] CRITICAL: No authorization code received from GitHub.');
        return res.redirect(`${FE_URL}/?error=authorization_code_missing`);
    }

    try {
        // 2. Exchange the authorization code for an access token
        console.log('[AUTH_CALLBACK] Exchanging code for access token...');
        const tokenResponse = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code: code,
            },
            { 
                headers: { 
                    'Accept': 'application/json' 
                } 
            }
        );

        // 3. Log the entire response from GitHub to check for errors or a missing token
        console.log('[AUTH_CALLBACK] Token exchange response data from GitHub:', tokenResponse.data);

        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            const errorDetails = tokenResponse.data.error_description || 'No access token in response';
            console.error(`[AUTH_CALLBACK] CRITICAL: Failed to get access token. Reason: ${errorDetails}`);
            return res.redirect(`${FE_URL}/?error=token_exchange_failed&details=${encodeURIComponent(errorDetails)}`);
        }

        // 4. Use the access token to fetch the user's profile from GitHub
        console.log('[AUTH_CALLBACK] Successfully received access token. Fetching user profile...');
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { 
                // Using 'Bearer' is the modern standard
                'Authorization': `Bearer ${accessToken}` 
            }
        });

        // 5. Log the user profile data to confirm it was fetched successfully
        const githubUser = userResponse.data;
        console.log('[AUTH_CALLBACK] Successfully fetched user profile:', { id: githubUser.id, login: githubUser.login });

        // This is where the original error occurred. If githubUser is undefined, the logs above will show why.
        
        // 6. Find or create the user in your local database
        let user = await databaseService.getUserByGithubId(githubUser.id.toString());
        if (user) {
            console.log(`[AUTH_CALLBACK] Found existing user in DB with ID: ${user.id}`);
        } else {
            console.log(`[AUTH_CALLBACK] User not found. Creating new user for GitHub login: ${githubUser.login}`);
            user = await databaseService.createUser({
                github_id: githubUser.id.toString(),
                github_username: githubUser.login,
                github_avatar_url: githubUser.avatar_url,
                github_profile_url: githubUser.html_url
            });
            console.log(`[AUTH_CALLBACK] Created new user in DB with ID: ${user.id}`);
        }

        // 7. Create a JWT for the user session
        const token = jwt.sign(
            { 
                userId: user.id, 
                githubId: user.github_id,
                username: user.github_username,
                accessToken: accessToken // Storing the GitHub token can be useful for subsequent API calls
            },
            process.env.JWT_SECRET, // Use the env secret; avoid fallback keys in production
            { expiresIn: '24h' }
        );
        console.log('[AUTH_CALLBACK] JWT created successfully. Redirecting to frontend.');

        // 8. Redirect to the frontend with the JWT, signaling a successful login
        return res.redirect(`${FE_URL}/auth/callback?token=${token}`);
        
    } catch (err) {
        // This block catches errors from the axios calls or database operations
        console.error('[AUTH_CALLBACK] FATAL ERROR during OAuth flow:', err.message);
        // If it's an API error, log the response data from GitHub for debugging
        if (err.response) {
            console.error('[AUTH_CALLBACK] Error Response Data from API:', err.response.data);
            console.error('[AUTH_CALLBACK] Error Response Status:', err.response.status);
        }
        return res.redirect(`${FE_URL}/?error=oauth_processing_failed`);
    }
};

// --- GET USER DATA ENDPOINT ---
// Fetches the current logged-in user's details from the database.
exports.getUser = async (req, res) => {
    try {
        // req.user is populated by your JWT authentication middleware
        const user = await databaseService.getUserByGithubId(req.user.githubId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const generationCount = await databaseService.getGenerationCount(user.id);
        const savedProfile = await databaseService.getUserProfile(user.id);
        
        // Determine if the user can generate a new profile
        const limit = 3; 
        const canGenerate = generationCount < limit;
        
        res.json({
            user: {
                id: user.id,
                username: user.github_username,
                avatar_url: user.github_avatar_url,
                profile_url: user.github_profile_url
            },
            generationCount,
            hasSavedProfile: !!savedProfile,
            canGenerate,
            remainingAttempts: Math.max(0, limit - generationCount)
        });
    } catch (err) {
        console.error(`[GET_USER] Error fetching user data for user ID ${req.user.userId}:`, err);
        res.status(500).json({ error: 'Failed to get user data' });
    }
};
