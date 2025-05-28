const jwt = require('jsonwebtoken');
const databaseService = require('../services/databaseService');

exports.githubAuth = (req, res) => {
    const includePrivate = req.query.include_private === 'true';
    const baseScope = 'read:user user:email';
    const privateScope = 'repo';
    const scope = includePrivate ? `${baseScope} ${privateScope}` : baseScope;
    const client_id = process.env.GITHUB_CLIENT_ID;
    const redirect_uri = process.env.GITHUB_REDIRECT_URI;
    const state = 'some_random_state';
    
    const authUrl = `https://github.com/login/oauth/authorize?` +
        `client_id=${client_id}` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&scope=${encodeURIComponent(scope)}` +
        `&state=${state}`;
    
    res.redirect(authUrl);
};

exports.githubCallback = async (req, res) => {
    const { code, state } = req.query;
    const FE = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    try {
        // Exchange code for access token
        const axios = require('axios');
        const tokenResp = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code,
                state
            },
            { headers: { accept: 'application/json' } }
        );
        
        const accessToken = tokenResp.data.access_token;
        if (!accessToken) {
            return res.redirect(`${FE}/?error=token_exchange_failed`);
        }

        // Get user data from GitHub
        const userResp = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `token ${accessToken}` }
        });

        const githubUser = userResp.data;
        
        // Create or get user from database - FIXED: githubId instead of githubld
        let user = await databaseService.getUserByGithubId(githubUser.id.toString());
        if (!user) {
            user = await databaseService.createUser({
                github_id: githubUser.id.toString(),
                github_username: githubUser.login,
                github_avatar_url: githubUser.avatar_url,
                github_profile_url: githubUser.html_url
            });
        }

        // Create JWT token - FIXED: userId and githubId instead of userld and githubld
        const token = jwt.sign(
            { 
                userId: user.id, 
                githubId: user.github_id,
                username: user.github_username,
                accessToken: accessToken 
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        // Redirect to frontend with token
        return res.redirect(`${FE}/auth/callback?token=${token}`);
        
    } catch (err) {
        console.error('OAuth callback error:', err);
        return res.redirect(`${FE}/?error=oauth_failed`);
    }
};

exports.getUser = async (req, res) => {
    try {
        // FIXED: githubId instead of githubld
        const user = await databaseService.getUserByGithubId(req.user.githubId);
        const generationCount = await databaseService.getGenerationCount(user.id);
        const savedProfile = await databaseService.getUserProfile(user.id);
        
        // Enhanced logic: Users without saved profiles can always generate at least once
        const effectiveLimit = savedProfile ? 3 : 2;
        const canGenerate = generationCount < effectiveLimit;
        
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
            remainingAttempts: Math.max(0, effectiveLimit - generationCount)
        });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Failed to get user data' });
    }
};
