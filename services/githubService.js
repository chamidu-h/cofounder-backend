const axios = require('axios');

// Fetch user profile data
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

// Fetch user repositories
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

    // Structured log for manual inspection
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: 'Fetched GitHub repositories',
      repoCount: response.data.length,
      repoNames: response.data.map(repo => ({
        name: repo.name,
        private: repo.private
      }))
    }, null, 2));

    return response.data;
  } catch (error) {
    console.error('Error fetching GitHub repositories:', error);
    throw error;
  }
};

// Fetch README (raw text)
exports.getRepoReadme = async (accessToken, owner, repo) => {
  try {
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: {
        Authorization: `token ${accessToken}`,
        accept: 'application/vnd.github.v3.raw'
      }
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching README for ${repo}:`, error.message);
    return '';
  }
};

// Fetch repo language stats
exports.getRepoLanguages = async (accessToken, owner, repo) => {
  try {
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/languages`, {
      headers: {
        Authorization: `token ${accessToken}`,
        accept: 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching languages for ${repo}:`, error.message);
    return {};
  }
};

// Fetch files/folders list for a given path
exports.getRepoFiles = async (accessToken, owner, repo, path = '') => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
          accept: 'application/vnd.github.v3+json'
        }
      }
    );
    if (Array.isArray(response.data)) {
      console.log(`[FETCH] Files in ${owner}/${repo}/${path}:`, response.data.map(f => f.path || f.name));
    }
    return response.data;
  } catch (error) {
    console.error(`Error fetching files for ${repo} at path "${path}":`, error.message);
    return [];
  }
};

// Fetch raw content of a specific file
exports.getFileContent = async (accessToken, owner, repo, filePath) => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
          accept: 'application/vnd.github.v3.raw'
        }
      }
    );
    let content = response.data;
    // If not a string, try to extract base64 content
    if (typeof content !== 'string' && content && typeof content === 'object' && content.content) {
      if (content.encoding === 'base64') {
        content = Buffer.from(content.content, 'base64').toString('utf-8');
      } else {
        content = String(content.content);
      }
    }
    // Only log if string
    if (typeof content === 'string') {
      console.log(`[FETCH] Content of ${owner}/${repo}/${filePath}:`, content.substring(0, 200) + '...');
    }
    return content;
  } catch (error) {
    console.error(`Error fetching file content for ${repo}/${filePath}:`, error.message);
    return '';
  }
};


// Heuristic: fetch only crucial files from root and top-level likely source dirs
exports.getCrucialFiles = async (accessToken, owner, repo) => {
  // Priority file names and config files
  const PRIORITY_FILES = [
    'main.py', 'index.js', 'app.js', 'server.js', 'index.ts', 'main.kt', 'main.java',
    'build.gradle', 'build.gradle.kts', 'pom.xml', 'package.json', 'requirements.txt', 'setup.py'
  ];
  const PRIORITY_DIRS = ['src', 'app', 'backend', 'frontend', 'server', 'api'];

  // Fetch root files and dirs
  const rootFiles = await exports.getRepoFiles(accessToken, owner, repo, '');
  if (!Array.isArray(rootFiles)) return [];

  // 1. Select priority files in root
  let crucialFiles = rootFiles.filter(f =>
    f.type === 'file' && PRIORITY_FILES.includes(f.name)
  );

  // 2. If not enough, look for code files in top-level likely source dirs
  if (crucialFiles.length < 2) {
    for (const dir of PRIORITY_DIRS) {
      const dirEntry = rootFiles.find(f => f.type === 'dir' && f.name === dir);
      if (dirEntry) {
        const dirFiles = await exports.getRepoFiles(accessToken, owner, repo, dir);
        if (Array.isArray(dirFiles)) {
          // Add priority-named files in this dir
          crucialFiles = crucialFiles.concat(
            dirFiles.filter(f => f.type === 'file' && PRIORITY_FILES.includes(f.name))
          );
          // If still not enough, add largest code files by extension
          if (crucialFiles.length < 2) {
            const codeFiles = dirFiles.filter(f =>
              f.type === 'file' && /\.(js|ts|py|java|kt|go|rb|php|cs)$/.test(f.name)
            );
            crucialFiles = crucialFiles.concat(
              codeFiles.sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 2 - crucialFiles.length)
            );
          }
        }
      }
      if (crucialFiles.length >= 2) break;
    }
  }

  // 3. If still not enough, add largest code files from root
  if (crucialFiles.length < 2) {
    const codeFiles = rootFiles.filter(f =>
      f.type === 'file' && /\.(js|ts|py|java|kt|go|rb|php|cs)$/.test(f.name)
    );
    crucialFiles = crucialFiles.concat(
      codeFiles.sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 2 - crucialFiles.length)
    );
  }

  // Deduplicate by file path
  const seen = new Set();
  crucialFiles = crucialFiles.filter(f => {
    if (seen.has(f.path || f.name)) return false;
    seen.add(f.path || f.name);
    return true;
  });

  return crucialFiles.slice(0, 2); // Max 2 files
};
