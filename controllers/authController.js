// controllers/authController.js
const axios = require('axios');
const githubService = require('../services/githubService');

exports.githubAuth = (req, res) => {
  // Check if the user opted to include private repository access via a query parameter
  const includePrivate = req.query.include_private === 'true';

  // Define scopes based on user selection:
  // "read:user user:email" for public data; add "repo" to include private repositories.
  const baseScope = 'read:user user:email';
  const privateScope = 'repo';
  const scope = includePrivate ? `${baseScope} ${privateScope}` : baseScope;

  const client_id = process.env.GITHUB_CLIENT_ID;
  const redirect_uri = process.env.GITHUB_REDIRECT_URI;
  const state = 'some_random_state'; // For security. In a production app, generate and validate this dynamically.

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(
    redirect_uri
  )}&scope=${encodeURIComponent(scope)}&state=${state}`;

  // Redirect the user to GitHub's OAuth consent page.
  res.redirect(authUrl);
};

exports.githubCallback = async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;

  if (!code) {
    return res.status(400).send('Authorization code not provided.');
  }

  try {
    // Exchange the code for an access token.
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
        state: state,
      },
      {
        headers: { accept: 'application/json' },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      return res.status(400).send('Access token not received.');
    }

    // Fetch basic user data and repositories.
    const userData = await githubService.getUserData(accessToken);
    const userRepos = await githubService.getUserRepos(accessToken);

    // Combine the data.
    const consolidatedData = { ...userData, repos: userRepos };

    // In a real-world scenario, you would now persist this data.
    res.json(consolidatedData);
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.status(500).send('GitHub authentication failed.');
  }
};
