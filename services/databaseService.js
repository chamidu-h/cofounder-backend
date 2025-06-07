// services/databaseService.js
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // Ensure environment variables are loaded

class DatabaseService {
  constructor() {
    if (!process.env.DATABASE_URL) {
      console.error("FATAL: DATABASE_URL environment variable is not set. PostgreSQL functionality will be disabled.");
      this.pool = null;
    } else {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // For cloud providers like Railway, SSL is often handled by the connection string.
        // If you face connection issues, you might need to enable this.
        // ssl: { rejectUnauthorized: false }
      });
      this.initializeDatabase();
    }
  }

  async initializeDatabase() {
    if (!this.pool) {
      console.warn("Database pool is not initialized. Skipping schema creation.");
      return;
    }

    // --- YOUR EXISTING SCHEMA ---
    const existingSchema = `
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
      CREATE TABLE IF NOT EXISTS connections (
        id SERIAL PRIMARY KEY,
        requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
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
    `;

    // --- NEW JOBS SCHEMA ---
    const jobsSchema = `
      CREATE TABLE IF NOT EXISTS jobs (
          id SERIAL PRIMARY KEY,
          job_title TEXT NOT NULL,
          company_name TEXT,
          job_url TEXT UNIQUE NOT NULL,
          description_html TEXT,
          searchable_text tsvector,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // --- TRIGGERS AND INDEXES (SEPARATED FOR IDEMPOTENCY) ---
    const triggersAndIndexes = `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at' AND tgrelid = 'users'::regclass) THEN
          CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profile_generations_updated_at' AND tgrelid = 'profile_generations'::regclass) THEN
          CREATE TRIGGER update_profile_generations_updated_at BEFORE UPDATE ON profile_generations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_saved_profiles_updated_at' AND tgrelid = 'saved_profiles'::regclass) THEN
          CREATE TRIGGER update_saved_profiles_updated_at BEFORE UPDATE ON saved_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_connections_updated_at' AND tgrelid = 'connections'::regclass) THEN
          CREATE TRIGGER update_connections_updated_at BEFORE UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END $$;

      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_requester_id') THEN CREATE INDEX idx_connections_requester_id ON connections(requester_id); END IF; END $$;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_addressee_id') THEN CREATE INDEX idx_connections_addressee_id ON connections(addressee_id); END IF; END $$;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'idx_connections_status') THEN CREATE INDEX idx_connections_status ON connections(status); END IF; END $$;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'jobs_search_idx') THEN CREATE INDEX jobs_search_idx ON jobs USING GIN (searchable_text); END IF; END $$;
    `;

    try {
      await this.pool.query(existingSchema);
      await this.pool.query(jobsSchema);
      await this.pool.query(triggersAndIndexes);
      console.log('Database schemas (Users, Connections, Jobs) initialized/verified successfully.');
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

  // --- EXISTING User, Profile, and Connections Methods ---
  // (Your existing methods for users, profiles, and connections go here.
  //  I have omitted them for brevity, but you should keep them in your file.)
  async getUserByGithubId(githubId) { /* ... */ }
  async createUser(userData) { /* ... */ }
  async getUserById(userId) { /* ... */ }
  async getGenerationCount(userId) { /* ... */ }
  async incrementGenerationCount(userId) { /* ... */ }
  async decrementGenerationCount(userId) { /* ... */ }
  async saveUserProfile(userId, profileData) { /* ... */ }
  async getUserProfile(userId) { /* ... */ }
  async deleteUserProfile(userId) { /* ... */ }
  async createConnectionRequest(requesterId, addresseeId) { /* ... */ }
  async getPendingRequestsForUser(userId) { /* ... */ }
  async getSentRequestsByUser(userId) { /* ... */ }
  async acceptConnectionRequest(requesterId, addresseeId) { /* ... */ }
  async declineOrCancelConnectionRequest(connectionId, currentUserId) { /* ... */ }
  async getActiveConnections(userId) { /* ... */ }
  async getConnectionStatus(userId1, userId2) { /* ... */ }


  // --- NEW: Job Data Methods ---

  /**
   * Fetches all jobs from the database for display.
   */
  async getAllJobs() {
    const sql = `
      SELECT id, job_title, company_name, job_url, description_html
      FROM jobs
      ORDER BY created_at DESC;
    `;
    const result = await this.query(sql);
    return result.rows;
  }

  /**
   * Imports jobs from an Excel file into the database.
   * This is designed to be called once by an authorized user or admin via an API endpoint.
   * @param {string} filePath - The absolute path to the Excel file on the server.
   */
  async importJobsFromExcel(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Excel file not found at path: ${filePath}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0]; // Assuming data is in the first sheet

    if (!worksheet) {
        throw new Error(`No worksheets found in the Excel file.`);
    }

    const jobsToInsert = [];
    let colMap = {};
    const headerRow = worksheet.getRow(1);
    if (!headerRow.values || headerRow.values.length === 1) { // Check for empty or invalid header
      throw new Error("Could not read header row from Excel file. Make sure it's not empty.");
    }
    headerRow.eachCell((cell, colNumber) => {
        colMap[cell.value] = colNumber;
    });

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

        if (job.url && job.title) {
            jobsToInsert.push(job);
        }
    });

    if (jobsToInsert.length === 0) {
        return { success: true, message: "No valid job rows to insert.", insertedCount: 0, updatedCount: 0, totalProcessed: 0 };
    }

    const client = await this.pool.connect();
    try {
        await client.query('BEGIN');

        let insertedCount = 0;
        let updatedCount = 0;

        for (const job of jobsToInsert) {
            const plainTextDescription = typeof job.description === 'string' ? job.description.replace(/<[^>]+>/g, ' ') : '';
            const insertQuery = `
                INSERT INTO jobs (job_title, company_name, job_url, description_html, searchable_text)
                VALUES ($1, $2, $3, $4, to_tsvector('english', $1 || ' ' || $2 || ' ' || $5))
                ON CONFLICT (job_url) DO UPDATE SET
                    job_title = EXCLUDED.job_title,
                    company_name = EXCLUDED.company_name,
                    description_html = EXCLUDED.description_html,
                    searchable_text = EXCLUDED.searchable_text
                RETURNING (xmax = 0) AS inserted; -- xmax=0 indicates an INSERT occurred
            `;
            const values = [job.title, job.company, job.url, job.description, plainTextDescription];
            const result = await client.query(insertQuery, values);

            if (result.rows[0] && result.rows[0].inserted) {
                insertedCount++;
            } else {
                updatedCount++;
            }
        }

        await client.query('COMMIT');
        return {
            success: true,
            message: `Successfully processed ${jobsToInsert.length} jobs.`,
            totalProcessed: jobsToInsert.length,
            insertedCount: insertedCount,
            updatedCount: updatedCount,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error during batch job insert:", error);
        throw error; // Re-throw to be caught by the controller
    } finally {
        client.release();
    }
  }
}

module.exports = new DatabaseService();
