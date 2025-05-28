// resetUserAttempts.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const username = 'chamidu-h';

// Try multiple possible database paths
const possiblePaths = [
    path.join(__dirname, '../database/cofounder.db'),
    path.join(__dirname, 'database/cofounder.db'),
    path.join(process.cwd(), 'database/cofounder.db'),
    path.join(process.cwd(), '../database/cofounder.db')
];

let dbPath = null;

// Find the correct database path
for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
        dbPath = testPath;
        console.log(`Found database at: ${dbPath}`);
        break;
    }
}

if (!dbPath) {
    console.error('Database file not found. Checked paths:');
    possiblePaths.forEach(p => console.error(`  - ${p}`));
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

db.get('SELECT id FROM users WHERE github_username = ?', [username], (err, row) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }
    
    if (!row) {
        console.log(`User ${username} not found`);
        db.close();
        return;
    }
    
    const userId = row.id;
    console.log(`User ID for ${username}: ${userId}`);
    
    // Reset generation count to 0
    db.run(
        `UPDATE profile_generations 
         SET generation_count = 0,
             last_generated_at = NULL,
             updated_at = datetime('now')
         WHERE user_id = ?`,
        [userId],
        function(err) {
            if (err) {
                console.error('Error resetting generations:', err);
            } else if (this.changes === 0) {
                // No existing record, create one with 0 count
                db.run(
                    `INSERT INTO profile_generations (user_id, generation_count, last_generated_at) 
                     VALUES (?, 0, NULL)`,
                    [userId],
                    function(err) {
                        if (err) {
                            console.error('Error creating generation record:', err);
                        } else {
                            console.log('✅ Generation record created with 0 attempts');
                        }
                        db.close();
                    }
                );
                return;
            } else {
                console.log('✅ Generation attempts reset to 0');
            }
            db.close();
        }
    );
});
