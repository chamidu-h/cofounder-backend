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

-- Connections table for connection requests and statuses
CREATE TABLE IF NOT EXISTS connections (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- e.g., 'pending', 'accepted'
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_connection_pair UNIQUE (requester_id, addressee_id),
  CONSTRAINT chk_no_self_connect CHECK (requester_id <> addressee_id)
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
  -- Apply the same trigger function to the new connections table
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_connections_updated_at' AND tgrelid = 'connections'::regclass) THEN
    CREATE TRIGGER update_connections_updated_at BEFORE UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Indexes for connections table
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_connections_requester_id' AND n.nspname = 'public') THEN
  CREATE INDEX idx_connections_requester_id ON connections(requester_id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_connections_addressee_id' AND n.nspname = 'public') THEN
  CREATE INDEX idx_connections_addressee_id ON connections(addressee_id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_connections_status' AND n.nspname = 'public') THEN
  CREATE INDEX idx_connections_status ON connections(status); END IF; END $$;
`;
    try {
      await this.pool.query(schema);
      // Updated log message for clarity
      console.log('Database schema (including connections table) initialized/verified successfully (PostgreSQL)');
    } catch (err) {
      console.error('Error initializing PostgreSQL database schema:', err);
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

  // --- User and Profile Methods (Existing - with result.rows[0] corrections) ---
  async getUserByGithubId(githubId) {
    const result = await this.query('SELECT * FROM users WHERE github_id = $1', [githubId]);
    return result.rows[0]; // Corrected: return single object or undefined
  }

  async createUser(userData) {
    const { github_id, github_username, github_avatar_url, github_profile_url } = userData;
    const result = await this.query(
      'INSERT INTO users (github_id, github_username, github_avatar_url, github_profile_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [github_id, github_username, github_avatar_url, github_profile_url]
    );
    return result.rows[0]; // Corrected: return single created object
  }

  async getUserById(userId) {
    const result = await this.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0]; // Corrected: return single object or undefined
  }

  async getGenerationCount(userId) {
    const result = await this.query('SELECT generation_count FROM profile_generations WHERE user_id = $1', [userId]);
    return result.rows[0] ? result.rows[0].generation_count : 0; // Corrected: access property of the single row object
  }

  async incrementGenerationCount(userId) {
    const sql = `
INSERT INTO profile_generations (user_id, generation_count, last_generated_at)
VALUES ($1, 1, NOW())
ON CONFLICT (user_id) DO UPDATE
SET generation_count = profile_generations.generation_count + 1,
last_generated_at = NOW(),
updated_at = NOW()
RETURNING generation_count;`;
    const result = await this.query(sql, [userId]);
    return result.rows[0].generation_count; // Corrected
  }

  async decrementGenerationCount(userId) {
    const sql = `
UPDATE profile_generations
SET generation_count = GREATEST(0, generation_count - 1)
WHERE user_id = $1 AND generation_count > 0
RETURNING generation_count;`;
    const result = await this.query(sql, [userId]);
    if (result.rowCount > 0) {
      return result.rows[0].generation_count; // Corrected
    }
    return this.getGenerationCount(userId); // This already returns a number
  }

  async saveUserProfile(userId, profileData) {
    const profileDataJson = JSON.stringify(profileData);
    const sql = `
INSERT INTO saved_profiles (user_id, profile_data)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE
SET profile_data = EXCLUDED.profile_data,
updated_at = NOW()
RETURNING *;`;
    const result = await this.query(sql, [userId, profileDataJson]);
    const savedRow = result.rows[0]; // Corrected
    if (savedRow && typeof savedRow.profile_data === 'string') {
      try {
        savedRow.profile_data = JSON.parse(savedRow.profile_data);
      } catch (e) {
        console.error("Failed to parse profile_data JSON on saveUserProfile result:", e);
      }
    }
    return savedRow;
  }

  async getUserProfile(userId) {
    const result = await this.query('SELECT * FROM saved_profiles WHERE user_id = $1', [userId]);
    if (result.rows[0]) { // Corrected
      let profile = result.rows[0]; // Corrected
      if (profile.profile_data && typeof profile.profile_data === 'string') {
        try {
          profile.profile_data = JSON.parse(profile.profile_data);
        } catch (e) {
          console.error("Failed to parse profile_data JSON on getUserProfile:", e);
        }
      }
      return profile;
    }
    return null;
  }

  async deleteUserProfile(userId) {
    const result = await this.query('DELETE FROM saved_profiles WHERE user_id = $1', [userId]);
    return result.rowCount;
  }

  // --- Connections Methods (Newly Added) ---
  async createConnectionRequest(requesterId, addresseeId) {
    const sql = `
      INSERT INTO connections (requester_id, addressee_id, status)
      VALUES ($1, $2, 'pending')
      RETURNING *;
    `;
    const result = await this.query(sql, [requesterId, addresseeId]);
    return result.rows[0]; // Return the created connection object
  }

  async getPendingRequestsForUser(userId) { // Incoming requests
    const sql = `
      SELECT c.*, u.github_username as requester_username, u.github_avatar_url as requester_avatar_url
      FROM connections c
      JOIN users u ON c.requester_id = u.id
      WHERE c.addressee_id = $1 AND c.status = 'pending'
      ORDER BY c.created_at DESC;
    `;
    const result = await this.query(sql, [userId]);
    return result.rows; // Returns an array of pending requests
  }

  async getSentRequestsByUser(userId) { // Outgoing requests
    const sql = `
      SELECT c.*, u.github_username as addressee_username, u.github_avatar_url as addressee_avatar_url
      FROM connections c
      JOIN users u ON c.addressee_id = u.id
      WHERE c.requester_id = $1 AND c.status = 'pending'
      ORDER BY c.created_at DESC;
    `;
    const result = await this.query(sql, [userId]);
    return result.rows; // Returns an array of sent requests
  }

  async acceptConnectionRequest(requesterId, addresseeId) {
    // Note: addresseeId is the current user accepting the request
    const sql = `
      UPDATE connections
      SET status = 'accepted', updated_at = NOW()
      WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'
      RETURNING *;
    `;
    const result = await this.query(sql, [requesterId, addresseeId]);
    return result.rows[0]; // Return the updated connection object
  }

  async declineOrCancelConnectionRequest(connectionId, currentUserId) {
    // This function allows a user to decline a request they received OR cancel a request they sent.
    // The connectionId is the ID of the 'connections' table row.
    const sql = `
      DELETE FROM connections
      WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2) AND status = 'pending'
      RETURNING id; 
    `;
    const result = await this.query(sql, [connectionId, currentUserId]);
    return result.rowCount; // Returns 1 if deleted, 0 otherwise
  }

  async getActiveConnections(userId) {
    const sql = `
      SELECT u.id, u.github_username, u.github_avatar_url, u.github_profile_url, c.status as connection_status, c.created_at as connection_created_at
      FROM users u
      JOIN connections c ON (c.requester_id = u.id AND c.addressee_id = $1 AND c.status = 'accepted')
                         OR (c.addressee_id = u.id AND c.requester_id = $1 AND c.status = 'accepted')
      WHERE u.id != $1;
    `;
    const result = await this.query(sql, [userId]);
    return result.rows; // Returns an array of connected user objects
  }

  async getConnectionStatus(userId1, userId2) {
    // Checks the status ('pending', 'accepted', or null if no connection) between two users.
    const sql = `
      SELECT status FROM connections
      WHERE (requester_id = $1 AND addressee_id = $2)
         OR (requester_id = $2 AND addressee_id = $1);
    `;
    const result = await this.query(sql, [userId1, userId2]);
    return result.rows[0] ? result.rows[0].status : null; // Return status string or null
  }
}

module.exports = new DatabaseService();
