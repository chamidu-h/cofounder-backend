const { Pool } = require('pg');

class DatabaseService {
    constructor() {
        if (!process.env.DATABASE_URL) {
            console.error("FATAL: DATABASE_URL environment variable is not set. PostgreSQL functionality will be disabled.");
            // In a production scenario, this might throw an error or prevent the app from starting.
            this.pool = null; 
        } else {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                // ssl: { rejectUnauthorized: false } // Add this if your PostgreSQL provider requires SSL and you encounter issues
                                                  // For Railway, this is often handled automatically or might need to be enabled.
            });
            this.initializeDatabase();
        }
    }

    async initializeDatabase() {
        if (!this.pool) {
            console.warn("Database pool is not initialized. Skipping schema creation.");
            return;
        }

        // PostgreSQL schema. Note changes:
        // - INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
        // - DATETIME DEFAULT CURRENT_TIMESTAMP -> TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        // - TEXT for profile_data -> JSONB (better for structured JSON)
        // - datetime('now') in SQLite queries -> NOW() or CURRENT_TIMESTAMP in PostgreSQL
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

            -- Trigger function to automatically update 'updated_at' columns
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
               NEW.updated_at = NOW();
               RETURN NEW;
            END;
            $$ language 'plpgsql';

            -- Apply trigger to tables if not already applied
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger
                    WHERE tgname = 'update_users_updated_at' AND tgrelid = 'users'::regclass
                ) THEN
                    CREATE TRIGGER update_users_updated_at
                    BEFORE UPDATE ON users
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger
                    WHERE tgname = 'update_profile_generations_updated_at' AND tgrelid = 'profile_generations'::regclass
                ) THEN
                    CREATE TRIGGER update_profile_generations_updated_at
                    BEFORE UPDATE ON profile_generations
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger
                    WHERE tgname = 'update_saved_profiles_updated_at' AND tgrelid = 'saved_profiles'::regclass
                ) THEN
                    CREATE TRIGGER update_saved_profiles_updated_at
                    BEFORE UPDATE ON saved_profiles
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
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

    // Helper to execute queries, centralizing error logging
    async query(sql, params = []) {
        if (!this.pool) {
            throw new Error("Database pool is not available.");
        }
        try {
            const result = await this.pool.query(sql, params);
            return result;
        } catch (err) {
            console.error('Database query error:', err.message, '\nSQL:', sql, '\nParams:', params);
            throw err; // Re-throw to be handled by the calling method
        }
    }

    async getUserByGithubId(githubId) {
        const result = await this.query('SELECT * FROM users WHERE github_id = $1', [githubId]);
        return result.rows[0];
    }

    async createUser(userData) {
        const { github_id, github_username, github_avatar_url, github_profile_url } = userData;
        // RETURNING * will give us the newly created user row, including its auto-generated 'id' and 'created_at', 'updated_at'
        const result = await this.query(
            'INSERT INTO users (github_id, github_username, github_avatar_url, github_profile_url) VALUES ($1, $2, $3, $4) RETURNING *',
            [github_id, github_username, github_avatar_url, github_profile_url]
        );
        return result.rows[0];
    }

    async getGenerationCount(userId) {
        const result = await this.query('SELECT generation_count FROM profile_generations WHERE user_id = $1', [userId]);
        return result.rows[0] ? result.rows[0].generation_count : 0;
    }

    async incrementGenerationCount(userId) {
        // Upsert logic: Insert if not exists, or update if exists.
        // `created_at` is handled by DEFAULT on INSERT.
        // `updated_at` is handled by the trigger for regular UPDATEs, but we set it explicitly here for ON CONFLICT.
        const sql = `
            INSERT INTO profile_generations (user_id, generation_count, last_generated_at)
            VALUES ($1, 1, NOW())
            ON CONFLICT (user_id) DO UPDATE
            SET generation_count = profile_generations.generation_count + 1,
                last_generated_at = NOW(),
                updated_at = NOW()  -- Explicitly set for the update part of upsert
            RETURNING generation_count; 
        `;
        // The previous SQLite logic with COALESCE for created_at is simplified by PostgreSQL's DEFAULT
        // and ON CONFLICT behavior.
        const result = await this.query(sql, [userId]);
        return result.rows[0].generation_count; // Returns the new count
    }

    async decrementGenerationCount(userId) {
        // Atomically decrement if count > 0.
        // The trigger will handle `updated_at`.
        const sql = `
            UPDATE profile_generations
            SET generation_count = GREATEST(0, generation_count - 1) -- Prevent going below 0
            WHERE user_id = $1 AND generation_count > 0
            RETURNING generation_count;
        `;
        const result = await this.query(sql, [userId]);
        if (result.rowCount > 0) {
            return result.rows[0].generation_count; // New count after decrement
        }
        // If no row was updated (user not found or count was already 0), return current count (which would be 0 or user not found)
        return this.getGenerationCount(userId); // This will return 0 if user_id not found or count is 0.
    }

    async saveUserProfile(userId, profileData) {
        const profileDataJson = JSON.stringify(profileData); // Store as JSON string for JSONB
        // Upsert logic for saved_profiles.
        // `created_at` handled by DEFAULT. `updated_at` by trigger or explicitly here.
        const sql = `
            INSERT INTO saved_profiles (user_id, profile_data)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE
            SET profile_data = EXCLUDED.profile_data, -- EXCLUDED refers to the values from the attempted INSERT
                updated_at = NOW() -- Explicitly set for the update part of upsert
            RETURNING *; 
        `;
        const result = await this.query(sql, [userId, profileDataJson]);
        const savedRow = result.rows[0];
        // node-postgres typically parses JSONB to an object. If it's a string, explicit parsing is needed.
        // For safety, we ensure profile_data is an object.
        if (savedRow && typeof savedRow.profile_data === 'string') {
            try {
                savedRow.profile_data = JSON.parse(savedRow.profile_data);
            } catch (e) {
                console.error("Failed to parse profile_data JSON on saveUserProfile result:", e);
                // Depending on requirements, might throw error or return row as is
            }
        }
        return savedRow;
    }

    async getUserProfile(userId) {
        const result = await this.query('SELECT * FROM saved_profiles WHERE user_id = $1', [userId]);
        if (result.rows[0]) {
            let profile = result.rows[0];
            // node-postgres usually auto-parses JSON/JSONB. This check is for robustness.
            if (profile.profile_data && typeof profile.profile_data === 'string') {
                try {
                    profile.profile_data = JSON.parse(profile.profile_data);
                } catch (e) {
                    console.error("Failed to parse profile_data JSON on getUserProfile:", e);
                    // Handle error or return profile with stringified data
                }
            }
            return profile;
        }
        return null;
    }

    async deleteUserProfile(userId) {
        const result = await this.query('DELETE FROM saved_profiles WHERE user_id = $1', [userId]);
        return result.rowCount; // Returns the number of rows deleted (0 or 1)
    }
}

module.exports = new DatabaseService();
