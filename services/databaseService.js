// services/databaseService.js

const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const fs = require('fs');
require('dotenv').config();

class DatabaseService {
  constructor() {
    this.pool = null;
    console.log("[DB Service] Instance created. Not yet connected.");
  }

  async connect() {
    if (this.pool) {
      console.log("[DB Service] Database pool already initialized.");
      return;
    }
    if (!process.env.DATABASE_URL) {
      console.error("[DB Service] FATAL: DATABASE_URL environment variable is not set.");
      throw new Error("DATABASE_URL environment variable is not set.");
    }
    try {
      console.log("[DB Service] Attempting to connect to PostgreSQL...");
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await this.pool.query('SELECT NOW()');
      console.log("[DB Service] PostgreSQL database connected successfully.");
      await this.initializeDatabase();
    } catch (error) {
      console.error("[DB Service] Failed to connect to or initialize the database:", error);
      this.pool = null;
      throw error;
    }
  }

  async initializeDatabase() {
    if (!this.pool) {
      console.warn("[DB Service] Cannot initialize schema, database pool is not available.");
      return;
    }
    console.log("[DB Service] Initializing database schema...");
    const schemasAndSetup = [
      `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, github_id TEXT UNIQUE NOT NULL, github_username TEXT NOT NULL, github_avatar_url TEXT, github_profile_url TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);`,
      `CREATE TABLE IF NOT EXISTS profile_generations (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, generation_count INTEGER DEFAULT 0, last_generated_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);`,
      `CREATE TABLE IF NOT EXISTS saved_profiles (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, profile_data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);`,
      `CREATE TABLE IF NOT EXISTS connections (id SERIAL PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status VARCHAR(20) NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, CONSTRAINT uq_connection_pair UNIQUE (requester_id, addressee_id), CONSTRAINT chk_no_self_connect CHECK (requester_id <> addressee_id));`,
      `CREATE TABLE IF NOT EXISTS jobs (id SERIAL PRIMARY KEY, job_title TEXT NOT NULL, company_name TEXT, job_url TEXT UNIQUE NOT NULL, description_html TEXT, searchable_text tsvector, created_at TIMESTAMPTZ DEFAULT NOW());`,
      `CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ language 'plpgsql';`,
      // --- NEW: User CVs Schema ---
`CREATE TABLE IF NOT EXISTS user_cvs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    cv_text TEXT NOT NULL,
    original_filename TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profile_generations_updated_at') THEN CREATE TRIGGER update_profile_generations_updated_at BEFORE UPDATE ON profile_generations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_saved_profiles_updated_at') THEN CREATE TRIGGER update_saved_profiles_updated_at BEFORE UPDATE ON saved_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_connections_updated_at') THEN CREATE TRIGGER update_connections_updated_at BEFORE UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_requester_id') THEN CREATE INDEX idx_connections_requester_id ON connections(requester_id); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_addressee_id') THEN CREATE INDEX idx_connections_addressee_id ON connections(addressee_id); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_status') THEN CREATE INDEX idx_connections_status ON connections(status); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'jobs_search_idx') THEN CREATE INDEX jobs_search_idx ON jobs USING GIN (searchable_text); END IF; END $$;`
    // --- NEW: Trigger for user_cvs ---
`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_cvs_updated_at') THEN
    CREATE TRIGGER update_user_cvs_updated_at BEFORE UPDATE ON user_cvs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;`
    ];
    try {
      for (const statement of schemasAndSetup) await this.pool.query(statement);
      console.log('[DB Service] All database schemas initialized/verified successfully.');
    } catch (err) {
      console.error('[DB Service] Error during schema initialization:', err);
      throw err;
    }
  }

  async query(sql, params = []) {
    if (!this.pool) throw new Error("Database pool is not available. Cannot execute query.");
    const client = await this.pool.connect();
    try {
      return await client.query(sql, params);
    } catch (err) {
      console.error('Database query error:', { query: sql, params, error: err.message });
      throw err;
    } finally {
      client.release();
    }
  }

  // --- User Methods ---
  async getUserByGithubId(githubId) {
    const result = await this.query('SELECT * FROM users WHERE github_id = $1', [githubId]);
    return result.rows[0];
  }
  async createUser(userData) {
    const result = await this.query('INSERT INTO users (github_id, github_username, github_avatar_url, github_profile_url) VALUES ($1, $2, $3, $4) RETURNING *', [userData.github_id, userData.github_username, userData.github_avatar_url, userData.github_profile_url]);
    return result.rows[0];
  }
  async getUserById(userId) {
    const result = await this.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0];
  }

  // --- Profile Generation Methods ---
  async getGenerationCount(userId) {
    const result = await this.query('SELECT generation_count FROM profile_generations WHERE user_id = $1', [userId]);
    return result.rows[0] ? result.rows[0].generation_count : 0;
  }
  async incrementGenerationCount(userId) {
    await this.query(`INSERT INTO profile_generations (user_id, generation_count, last_generated_at) VALUES ($1, 1, NOW()) ON CONFLICT (user_id) DO UPDATE SET generation_count = profile_generations.generation_count + 1, last_generated_at = NOW();`, [userId]);
  }
  async decrementGenerationCount(userId) {
    await this.query(`UPDATE profile_generations SET generation_count = GREATEST(0, generation_count - 1) WHERE user_id = $1 AND generation_count > 0`, [userId]);
  }

  // --- Saved Profile Methods ---
  async saveUserProfile(userId, profileData) {
    const result = await this.query(`INSERT INTO saved_profiles (user_id, profile_data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET profile_data = EXCLUDED.profile_data RETURNING *;`, [userId, profileData]);
    return result.rows[0];
  }
  async getUserProfile(userId) {
    const result = await this.query('SELECT * FROM saved_profiles WHERE user_id = $1', [userId]);
    return result.rows[0];
  }
  async deleteUserProfile(userId) {
    const result = await this.query('DELETE FROM saved_profiles WHERE user_id = $1', [userId]);
    return result.rowCount;
  }

  // --- Connection Methods (Restored and Complete) ---
  async createConnectionRequest(requesterId, addresseeId) {
    const result = await this.query(`INSERT INTO connections (requester_id, addressee_id, status) VALUES ($1, $2, 'pending') RETURNING *;`, [requesterId, addresseeId]);
    return result.rows[0];
  }
  async getPendingRequestsForUser(userId) {
    const result = await this.query(`SELECT c.id, c.requester_id, u.github_username as requester_username, u.github_avatar_url as requester_avatar FROM connections c JOIN users u ON c.requester_id = u.id WHERE c.addressee_id = $1 AND c.status = 'pending';`, [userId]);
    return result.rows;
  }
  async getSentRequestsByUser(userId) { // <<< THIS WAS THE MISSING FUNCTION
    const result = await this.query(`SELECT c.*, u.github_username as addressee_username, u.github_avatar_url as addressee_avatar_url FROM connections c JOIN users u ON c.addressee_id = u.id WHERE c.requester_id = $1 AND c.status = 'pending' ORDER BY c.created_at DESC;`, [userId]);
    return result.rows;
  }
  async acceptConnectionRequest(requesterId, addresseeId) {
    const result = await this.query(`UPDATE connections SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending' RETURNING *;`, [requesterId, addresseeId]);
    return result.rows[0];
  }
  async declineOrCancelConnectionRequest(connectionId, currentUserId) {
    const result = await this.query(`DELETE FROM connections WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2);`, [connectionId, currentUserId]);
    return result.rowCount > 0;
  }
  async getActiveConnections(userId) {
    const result = await this.query(`SELECT u.* FROM users u JOIN connections c ON (c.requester_id = u.id OR c.addressee_id = u.id) WHERE (c.requester_id = $1 OR c.addressee_id = $1) AND c.status = 'accepted' AND u.id != $1;`, [userId]);
    return result.rows;
  }
  async getConnectionStatus(userId1, userId2) {
    const result = await this.query(`SELECT * FROM connections WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1);`, [userId1, userId2]);
    return result.rows[0];
  }

  // --- Job Data Methods ---
  async getAllJobs() {
    const result = await this.query(`SELECT id, job_title, company_name, job_url, description_html
      FROM jobs
      ORDER BY created_at DESC;`);
    return result.rows;
  }
  async importJobsFromExcel(filePath) {
    // This function remains unchanged from the previous correct implementation
    if (!fs.existsSync(filePath)) throw new Error(`Excel file not found at path: ${filePath}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error(`No worksheets found in the Excel file.`);

    const jobsToProcess = [];
    let colMap = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => { colMap[cell.value] = colNumber; });

    const requiredCols = ['Job Title', 'Company', 'Description', 'Job URL'];
    for (const col of requiredCols) {
      if (!colMap[col]) throw new Error(`Missing required column in Excel: "${col}"`);
    }

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const job = { title: row.getCell(colMap['Job Title']).value, company: row.getCell(colMap['Company']).value, description: row.getCell(colMap['Description']).value, url: row.getCell(colMap['Job URL']).value?.text || row.getCell(colMap['Job URL']).value };
      if (job.url && job.title) jobsToProcess.push(job);
    });

    if (jobsToProcess.length === 0) return { success: true, message: "No valid job rows found to process.", totalProcessed: 0, insertedCount: 0, updatedCount: 0 };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let insertedCount = 0, updatedCount = 0;
      for (const job of jobsToProcess) {
        const plainTextDescription = typeof job.description === 'string' ? job.description.replace(/<[^>]+>/g, ' ') : '';
        const query = `INSERT INTO jobs (job_title, company_name, job_url, description_html, searchable_text) VALUES ($1, $2, $3, $4, to_tsvector('english', $1 || ' ' || $2 || ' ' || $5)) ON CONFLICT (job_url) DO UPDATE SET job_title = EXCLUDED.job_title, company_name = EXCLUDED.company_name, description_html = EXCLUDED.description_html, searchable_text = EXCLUDED.searchable_text RETURNING (xmax = 0) AS inserted;`;
        const values = [job.title, job.company, job.url, job.description, plainTextDescription];
        const result = await client.query(query, values);
        if (result.rows[0] && result.rows[0].inserted) insertedCount++;
        else updatedCount++;
      }
      await client.query('COMMIT');
      return { success: true, message: `Successfully processed ${jobsToProcess.length} jobs.`, totalProcessed: jobsToProcess.length, insertedCount, updatedCount };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("Error during batch job insert:", error);
      throw error;
    } finally {
      client.release();
    }
  }
}

const databaseServiceInstance = new DatabaseService();
module.exports = databaseServiceInstance;
