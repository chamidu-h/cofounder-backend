// services/databaseService.js
const { Pool } = require('pg');

class DatabaseService {
  constructor() {
    if (!process.env.DATABASE_URL) {
      console.error("FATAL: DATABASE_URL environment variable is not set. PostgreSQL functionality will be disabled.");
      this.pool = null;
    } else {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // ssl: { rejectUnauthorized: false } // Uncomment if needed for your Postgres provider
      });
      this.initializeDatabase();
    }
  }

  async initializeDatabase() {
    if (!this.pool) {
      console.warn("Database pool is not initialized. Skipping schema creation.");
      return;
    }
    const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  github_id TEXT UNIQUE NOT NULL,
  github_username TEXT NOT NULL,
  github_avatar_url TEXT,
  github_profile_url TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profile_generations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  generation_count INTEGER DEFAULT 0,
  last_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS saved_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  profile_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at' AND tgrelid = 'users'::regclass) THEN
    CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profile_generations_updated_at' AND tgrelid = 'profile_generations'::regclass) THEN
    CREATE TRIGGER update_profile_generations_updated_at BEFORE UPDATE ON profile_generations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_saved_profiles_updated_at' AND tgrelid = 'saved_profiles'::regclass) THEN
    CREATE TRIGGER update_saved_profiles_updated_at BEFORE UPDATE ON saved_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
`;
    try {
      await this.pool.query(schema);
      console.log('Database initialized successfully (PostgreSQL)');
    } catch (err) {
      console.error('Error initializing PostgreSQL database:', err);
    }
  }

  async query(sql, params = []) {
    if (!this.pool) {
      throw new Error("Database pool is not available.");
    }
    try {
      const result = await this.pool.query(sql, params);
      return result;
    } catch (err) {
      console.error('Database query error:', err.message, '\nSQL:', sql, '\nParams:', params);
      throw err;
    }
  }

  async getUserByGithubId(githubId) { // Corrected parameter name
    const result = await this.query('SELECT * FROM users WHERE github_id = $1', [githubId]);
    return result.rows[0];
  }

  async createUser(userData) {
    const { github_id, github_username, github_avatar_url, github_profile_url } = userData;
    const result = await this.query(
      'INSERT INTO users (github_id, github_username, github_avatar_url, github_profile_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [github_id, github_username, github_avatar_url, github_profile_url]
    );
    return result.rows[0];
  }
  
  // You might need this method for your /api/auth/user endpoint
  async getUserById(userId) {
    const result = await this.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0];
  }

  async getGenerationCount(userId) { // Corrected parameter name
    const result = await this.query('SELECT generation_count FROM profile_generations WHERE user_id = $1', [userId]);
    return result.rows[0] ? result.rows[0].generation_count : 0;
  }

  async incrementGenerationCount(userId) { // Corrected parameter name
    const sql = `
INSERT INTO profile_generations (user_id, generation_count, last_generated_at)
VALUES ($1, 1, NOW())
ON CONFLICT (user_id) DO UPDATE
SET generation_count = profile_generations.generation_count + 1,
last_generated_at = NOW(),
updated_at = NOW()
RETURNING generation_count;`;
    const result = await this.query(sql, [userId]);
    return result.rows[0].generation_count;
  }

  async decrementGenerationCount(userId) { // Corrected throughout
    const sql = `
UPDATE profile_generations
SET generation_count = GREATEST(0, generation_count - 1)
WHERE user_id = $1 AND generation_count > 0
RETURNING generation_count;`;
    const result = await this.query(sql, [userId]);
    if (result.rowCount > 0) {
      return result.rows[0].generation_count;
    }
    return this.getGenerationCount(userId);
  }

  async saveUserProfile(userId, profileData) { // Corrected parameter name
    const profileDataJson = JSON.stringify(profileData);
    const sql = `
INSERT INTO saved_profiles (user_id, profile_data)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE
SET profile_data = EXCLUDED.profile_data,
updated_at = NOW()
RETURNING *;`;
    const result = await this.query(sql, [userId, profileDataJson]);
    const savedRow = result.rows[0];
    if (savedRow && typeof savedRow.profile_data === 'string') {
      try {
        savedRow.profile_data = JSON.parse(savedRow.profile_data);
      } catch (e) {
        console.error("Failed to parse profile_data JSON on saveUserProfile result:", e);
      }
    }
    return savedRow;
  }

  async getUserProfile(userId) { // Corrected parameter name
    // This corresponds to GET /api/profile (if backend maps it here)
    // Or it's used internally by profileController for /api/profile/saved
    const result = await this.query('SELECT * FROM saved_profiles WHERE user_id = $1', [userId]);
    if (result.rows[0]) {
      let profile = result.rows[0];
      if (profile.profile_data && typeof profile.profile_data === 'string') {
        try {
          profile.profile_data = JSON.parse(profile.profile_data);
        } catch (e) {
          console.error("Failed to parse profile_data JSON on getUserProfile:", e);
        }
      }
      return profile; // Should be the full row { id, user_id, profile_data, ... }
    }
    return null;
  }

  async deleteUserProfile(userId) { // Parameter name is userId
    // Corresponds to DELETE /api/profile/delete or /api/profile/saved in backend
    const result = await this.query('DELETE FROM saved_profiles WHERE user_id = $1', [userId]); // Corrected usage
    return result.rowCount;
  }
}

module.exports = new DatabaseService();
