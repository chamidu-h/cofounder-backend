const jwt = require('jsonwebtoken');
const axios = require('axios');

module.exports = (db) => ({
  githubAuth: (req, res) => {
    try {
      const includePrivate = req.query.include_private === 'true';
      const baseScope = 'read:user user:email';
      const privateScope = 'repo';
      const scope = includePrivate ? `${baseScope} ${privateScope}` : baseScope;
      const client_id = process.env.GITHUB_CLIENT_ID;
      const redirect_uri = process.env.GITHUB_REDIRECT_URI;
      if (!client_id || !redirect_uri) {
        console.error('[AUTH_INIT] GITHUB_CLIENT_ID or GITHUB_REDIRECT_URI is not set.');
        return res.status(500).send('Server configuration error.');
      }
      const state = 'some_random_state';
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
      console.log('[AUTH_INIT] Redirecting user to GitHub.');
      res.redirect(authUrl);
    } catch (error) {
      console.error('[AUTH_INIT] Error creating GitHub auth URL:', error);
      res.status(500).send('An unexpected error occurred.');
    }
  },

  githubCallback: async (req, res) => {
    const { code } = req.query;
    const FE_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
    console.log('[AUTH_CALLBACK] Received callback from GitHub.');
    if (!code) {
      console.error('[AUTH_CALLBACK] No authorization code received.');
      return res.redirect(`${FE_URL}/?error=authorization_code_missing`);
    }
    try {
      console.log('[AUTH_CALLBACK] Exchanging code for access token...');
      const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', { client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: code }, { headers: { 'Accept': 'application/json' } });
      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) {
        const errorDetails = tokenResponse.data.error_description || 'No access token in response';
        console.error(`[AUTH_CALLBACK] Failed to get access token: ${errorDetails}`);
        return res.redirect(`${FE_URL}/?error=token_exchange_failed&details=${encodeURIComponent(errorDetails)}`);
      }
      console.log('[AUTH_CALLBACK] Fetching user profile...');
      const userResponse = await axios.get('https://api.github.com/user', { headers: { 'Authorization': `Bearer ${accessToken}` } });
      const githubUser = userResponse.data;
      console.log(`[AUTH_CALLBACK] Fetched user: ${githubUser.login}`);
      let user = await db.getUserByGithubId(githubUser.id.toString());
      if (!user) {
        user = await db.createUser({ github_id: githubUser.id.toString(), github_username: githubUser.login, github_avatar_url: githubUser.avatar_url, github_profile_url: githubUser.html_url });
        console.log(`[AUTH_CALLBACK] Created new user in DB with ID: ${user.id}`);
      }
      const token = jwt.sign({ userId: user.id, githubId: user.github_id, username: user.github_username, accessToken: accessToken }, process.env.JWT_SECRET, { expiresIn: '24h' });
      console.log('[AUTH_CALLBACK] JWT created. Redirecting to frontend.');
      return res.redirect(`${FE_URL}/auth/callback?token=${token}`);
    } catch (err) {
      console.error('[AUTH_CALLBACK] FATAL ERROR during OAuth flow:', err.message);
      if (err.response) console.error('[AUTH_CALLBACK] Error Response Data:', err.response.data);
      return res.redirect(`${FE_URL}/?error=oauth_processing_failed`);
    }
  },

  getUser: async (req, res) => {
    try {
      const user = await db.getUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const generationCount = await db.getGenerationCount(user.id);
      const savedProfile = await db.getUserProfile(user.id);
      const limit = 3;
      const canGenerate = generationCount < limit;
      res.json({ user: { id: user.id, username: user.github_username, avatar_url: user.github_avatar_url, profile_url: user.github_profile_url }, generationCount, hasSavedProfile: !!savedProfile, canGenerate, remainingAttempts: Math.max(0, limit - generationCount) });
    } catch (err) {
      console.error(`[GET_USER] Error fetching user data for user ID ${req.user.userId}:`, err);
      res.status(500).json({ error: 'Failed to get user data' });
    }
  }
});
