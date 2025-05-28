const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseService {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, '../database/cofounder.db'));
        this.initializeDatabase();
    }

    initializeDatabase() {
        const schema = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                github_id TEXT UNIQUE NOT NULL,
                github_username TEXT NOT NULL,
                github_avatar_url TEXT,
                github_profile_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS profile_generations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                generation_count INTEGER DEFAULT 0,
                last_generated_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS saved_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                profile_data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `;

        this.db.exec(schema, (err) => {
            if (err) {
                console.error('Error initializing database:', err);
            } else {
                console.log('Database initialized successfully');
            }
        });
    }

    // FIXED: githubId instead of githubld
    async getUserByGithubId(githubId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM users WHERE github_id = ?',
                [githubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async createUser(userData) {
        return new Promise((resolve, reject) => {
            const { github_id, github_username, github_avatar_url, github_profile_url } = userData;
            this.db.run(
                'INSERT INTO users (github_id, github_username, github_avatar_url, github_profile_url) VALUES (?, ?, ?, ?)',
                [github_id, github_username, github_avatar_url, github_profile_url],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, ...userData });
                }
            );
        });
    }

    // FIXED: userId instead of userld
    async getGenerationCount(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT generation_count FROM profile_generations WHERE user_id = ?',
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.generation_count : 0);
                }
            );
        });
    }

    // FIXED: userId instead of userld
    async incrementGenerationCount(userId) {
        return new Promise((resolve, reject) => {
            // Use INSERT OR REPLACE for simpler upsert
            this.db.run(
                `INSERT OR REPLACE INTO profile_generations 
                 (user_id, generation_count, last_generated_at, created_at, updated_at) 
                 VALUES (
                     ?, 
                     COALESCE((SELECT generation_count FROM profile_generations WHERE user_id = ?), 0) + 1,
                     datetime('now'),
                     COALESCE((SELECT created_at FROM profile_generations WHERE user_id = ?), datetime('now')),
                     datetime('now')
                 )`,
                [userId, userId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    // FIXED: userId instead of userld
    async saveUserProfile(userId, profileData) {
        return new Promise((resolve, reject) => {
            // Use INSERT OR REPLACE for simpler upsert
            this.db.run(
                `INSERT OR REPLACE INTO saved_profiles 
                 (user_id, profile_data, created_at, updated_at) 
                 VALUES (
                     ?, 
                     ?,
                     COALESCE((SELECT created_at FROM saved_profiles WHERE user_id = ?), datetime('now')),
                     datetime('now')
                 )`,
                [userId, JSON.stringify(profileData), userId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, user_id: userId, profile_data: profileData });
                }
            );
        });
    }

    // FIXED: userId instead of userld
    async getUserProfile(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM saved_profiles WHERE user_id = ?',
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? { ...row, profile_data: JSON.parse(row.profile_data) } : null);
                }
            );
        });
    }

    // FIXED: userId instead of userld
    async deleteUserProfile(userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM saved_profiles WHERE user_id = ?',
                [userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    // FIXED: userId instead of userld
    async decrementGenerationCount(userId) {
        return new Promise((resolve, reject) => {
            // First check current count
            this.db.get(
                'SELECT generation_count FROM profile_generations WHERE user_id = ?',
                [userId],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (row && row.generation_count > 0) {
                        // Decrease count by 1 if greater than 0
                        this.db.run(
                            `UPDATE profile_generations 
                             SET generation_count = generation_count - 1,
                                 updated_at = datetime('now')
                             WHERE user_id = ?`,
                            [userId],
                            function(err) {
                                if (err) reject(err);
                                else resolve(this.changes);
                            }
                        );
                    } else {
                        // No record exists or count is already 0, do nothing
                        resolve(0);
                    }
                }
            );
        });
    }
}

module.exports = new DatabaseService();
