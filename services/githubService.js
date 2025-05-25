// services/githubService.js
const axios = require('axios');

exports.getUserData = async (accessToken) => {
  try {
    const response = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`,
        accept: 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching GitHub user data:', error);
    throw error;
  }
};

exports.getUserRepos = async (accessToken) => {
  try {
    const response = await axios.get('https://api.github.com/user/repos', {
      headers: {
        Authorization: `token ${accessToken}`,
        accept: 'application/json'
      },
      params: {
        sort: 'updated',
        per_page: 100
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching GitHub repositories:', error);
    throw error;
  }
};

exports.getRepoReadme = async (accessToken, owner, repo) => {
  try {
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: {
        Authorization: `token ${accessToken}`,
        // Use GitHub’s raw media type to get the text content
        accept: 'application/vnd.github.v3.raw'
      }
    });
    return response.data; // Returns raw README text
  } catch (error) {
    // If the repository has no README or an error occurs, return an empty string.
    console.error(`Error fetching README for ${repo}:`, error.message);
    return '';
  }
};

exports.getRepoLanguages = async (accessToken, owner, repo) => {
  try {
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/languages`, {
      headers: {
        Authorization: `token ${accessToken}`,
        accept: 'application/json'
      }
    });
    return response.data; // Returns an object of language usage
  } catch (error) {
    console.error(`Error fetching languages for ${repo}:`, error.message);
    return {}; // Return empty object on error
  }
};
