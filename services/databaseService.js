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

  /**
   * Establishes a connection to the PostgreSQL database and initializes the schema.
   * This method must be called explicitly during application startup.
   */
  async connect() {
    // Prevent multiple connection attempts
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
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // ssl: { rejectUnauthorized: false } // Keep as needed for Railway/cloud providers
      });

      // Test the connection to ensure it's live before proceeding
      await this.pool.query('SELECT NOW()');
      console.log("[DB Service] PostgreSQL database connected successfully.");

      // Initialize all database schemas after a successful connection
      await this.initializeDatabase();

    } catch (error) {
      console.error("[DB Service] Failed to connect to or initialize the database:", error);
      this.pool = null; // Ensure pool is null on failure to prevent further use
      throw error; // Re-throw the error so the server startup process can handle it
    }
  }

  /**
   * Creates all necessary tables, functions, triggers, and indexes if they don't exist.
   * This is called by the `connect` method.
   */
  async initializeDatabase() {
    if (!this.pool) {
      console.warn("[DB Service] Cannot initialize schema, database pool is not available.");
      return;
    }
    console.log("[DB Service] Initializing database schema...");

    const schemasAndSetup = [
      // --- Users and Profiles Schema ---
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, github_id TEXT UNIQUE NOT NULL, github_username TEXT NOT NULL, github_avatar_url TEXT,
        github_profile_url TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS profile_generations (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, generation_count INTEGER DEFAULT 0,
        last_generated_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS saved_profiles (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, profile_data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );`,
      // --- Connections Schema ---
      `CREATE TABLE IF NOT EXISTS connections (
        id SERIAL PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_connection_pair UNIQUE (requester_id, addressee_id),
        CONSTRAINT chk_no_self_connect CHECK (requester_id <> addressee_id)
      );`,
      // --- NEW: Jobs Schema ---
      `CREATE TABLE IF NOT EXISTS jobs (
          id SERIAL PRIMARY KEY, job_title TEXT NOT NULL, company_name TEXT, job_url TEXT UNIQUE NOT NULL,
          description_html TEXT, searchable_text tsvector, created_at TIMESTAMPTZ DEFAULT NOW()
      );`,
      // --- Utility Function for Timestamps ---
      `CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ language 'plpgsql';`,
      // --- Triggers and Indexes ---
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profile_generations_updated_at') THEN CREATE TRIGGER update_profile_generations_updated_at BEFORE UPDATE ON profile_generations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_saved_profiles_updated_at') THEN CREATE TRIGGER update_saved_profiles_updated_at BEFORE UPDATE ON saved_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_connections_updated_at') THEN CREATE TRIGGER update_connections_updated_at BEFORE UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_requester_id') THEN CREATE INDEX idx_connections_requester_id ON connections(requester_id); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_addressee_id') THEN CREATE INDEX idx_connections_addressee_id ON connections(addressee_id); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_status') THEN CREATE INDEX idx_connections_status ON connections(status); END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'jobs_search_idx') THEN CREATE INDEX jobs_search_idx ON jobs USING GIN (searchable_text); END IF; END $$;`
    ];

    try {
      // Execute each schema statement one by one for better error isolation
      for (const statement of schemasAndSetup) {
        await this.pool.query(statement);
      }
      console.log('[DB Service] All database schemas initialized/verified successfully.');
    } catch (err) {
      console.error('[DB Service] Error during schema initialization:', err);
      throw err; // Propagate error to the connect() method's catch block
    }
  }

  /**
   * Generic query function to execute any SQL query with parameters.
   */
  async query(sql, params = []) {
    if (!this.pool) {
      throw new Error("Database pool is not available. Cannot execute query.");
    }
    try {
      const result = await this.pool.query(sql, params);
      return result;
    } catch (err) {
      console.error('Database query error:', err.message);
      throw err;
    }
  }

  // --- EXISTING User, Profile, and Connections Methods ---
  // The implementations for these methods are omitted for brevity but should be here.
  async getUserByGithubId(githubId) { /* Your implementation here */ }
  async createUser(userData) { /* Your implementation here */ }
  async getUserById(userId) { /* Your implementation here */ }
  async getGenerationCount(userId) { /* Your implementation here */ }
  async incrementGenerationCount(userId) { /* Your implementation here */ }
  async decrementGenerationCount(userId) { /* Your implementation here */ }
  async saveUserProfile(userId, profileData) { /* Your implementation here */ }
  async getUserProfile(userId) { /* Your implementation here */ }
  async deleteUserProfile(userId) { /* Your implementation here */ }
  async createConnectionRequest(requesterId, addresseeId) { /* Your implementation here */ }
  async getPendingRequestsForUser(userId) { /* Your implementation here */ }
  async getSentRequestsByUser(userId) { /* Your implementation here */ }
  async acceptConnectionRequest(requesterId, addresseeId) { /* Your implementation here */ }
  async declineOrCancelConnectionRequest(connectionId, currentUserId) { /* Your implementation here */ }
  async getActiveConnections(userId) { /* Your implementation here */ }
  async getConnectionStatus(userId1, userId2) { /* Your implementation here */ }

  // --- NEW: Job Data Methods ---

  /**
   * Fetches all jobs from the database for display.
   */
  async getAllJobs() {
    const sql = `SELECT id, job_title, company_name, job_url, description_html FROM jobs ORDER BY created_at DESC;`;
    const result = await this.query(sql);
    return result.rows;
  }

  /**
   * Imports jobs from an Excel file into the database.
   * It updates existing jobs based on job_url and inserts new ones.
   */
  async importJobsFromExcel(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Excel file not found at path: ${filePath}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new Error(`No worksheets found in the Excel file.`);
    }

    const jobsToProcess = [];
    let colMap = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => { colMap[cell.value] = colNumber; });

    const requiredCols = ['Job Title', 'Company', 'Description', 'Job URL'];
    for (const col of requiredCols) {
        if (!colMap[col]) throw new Error(`Missing required column in Excel: "${col}"`);
    }

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header

        const job = {
            title: row.getCell(colMap['Job Title']).value,
            company: row.getCell(colMap['Company']).value,
            description: row.getCell(colMap['Description']).value,
            url: row.getCell(colMap['Job URL']).value?.text || row.getCell(colMap['Job URL']).value
        };

        if (job.url && job.title) jobsToProcess.push(job);
    });

    if (jobsToProcess.length === 0) {
      return { success: true, message: "No valid job rows found in Excel to process.", totalProcessed: 0, insertedCount: 0, updatedCount: 0 };
    }

    const client = await this.pool.connect();
    try {
        await client.query('BEGIN');
        let insertedCount = 0, updatedCount = 0;

        for (const job of jobsToProcess) {
            const plainTextDescription = typeof job.description === 'string' ? job.description.replace(/<[^>]+>/g, ' ') : '';
            const query = `
                INSERT INTO jobs (job_title, company_name, job_url, description_html, searchable_text)
                VALUES ($1, $2, $3, $4, to_tsvector('english', $1 || ' ' || $2 || ' ' || $5))
                ON CONFLICT (job_url) DO UPDATE SET
                    job_title = EXCLUDED.job_title,
                    company_name = EXCLUDED.company_name,
                    description_html = EXCLUDED.description_html,
                    searchable_text = EXCLUDED.searchable_text
                RETURNING (xmax = 0) AS inserted;
            `;
            const values = [job.title, job.company, job.url, job.description, plainTextDescription];
            const result = await client.query(query, values);

            if (result.rows[0] && result.rows[0].inserted) {
                insertedCount++;
            } else {
                updatedCount++;
            }
        }
        await client.query('COMMIT');
        return {
            success: true, message: `Successfully processed ${jobsToProcess.length} jobs.`,
            totalProcessed: jobsToProcess.length, insertedCount, updatedCount
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error during batch job insert:", error);
        throw error;
    } finally {
        client.release();
    }
  }
}

// Export a SINGLE, shared instance of the service.
const databaseServiceInstance = new DatabaseService();
module.exports = databaseServiceInstance;
