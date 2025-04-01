// services/githubService.js
const axios = require('axios');

exports.getUserData = async (accessToken) => {
  try {
    // Request basic user data from GitHub.
    const response = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`,
        accept: 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching GitHub user data:', error);
    throw error;
  }
};

exports.getUserRepos = async (accessToken) => {
  try {
    // Fetch repositories. If the token has the "repo" scope, private repos are also returned.
    const response = await axios.get('https://api.github.com/user/repos', {
      headers: {
        Authorization: `token ${accessToken}`,
        accept: 'application/json',
      },
      params: {
        sort: 'updated',  // Sort by most recently updated
        per_page: 100,    // Adjust as needed
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching GitHub repositories:', error);
    throw error;
  }
};
