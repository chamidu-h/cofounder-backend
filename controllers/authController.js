// controllers/authController.js
const axios = require('axios');
const profileService = require('../services/profileService');

exports.githubAuth = (req, res) => {
  const includePrivate = req.query.include_private === 'true';
  const baseScope    = 'read:user user:email';
  const privateScope = 'repo';
  const scope        = includePrivate ? `${baseScope} ${privateScope}` : baseScope;
  const client_id    = process.env.GITHUB_CLIENT_ID;
  const redirect_uri = process.env.GITHUB_REDIRECT_URI;
  const state        = 'some_random_state';

  const authUrl = `https://github.com/login/oauth/authorize?` +
    `client_id=${client_id}` +
    `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}`;

  res.redirect(authUrl);
};

exports.githubCallback = async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Authorization code not provided.');

  try {
    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      { client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code, state },
      { headers: { accept: 'application/json' } }
    );

    const accessToken = tokenResp.data.access_token;
    if (!accessToken) return res.status(400).send('Access token not received.');

    const structuredProfile = await profileService.generateStructuredProfile(accessToken);

    res.json({
      message: 'User profile generated successfully',
      profile: structuredProfile
    });

  } catch (err) {
    console.error('Error in GitHub OAuth/profile flow:', err);
    res.status(500).send('Profile generation failed.');
  }
};
