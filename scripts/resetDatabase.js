// scripts/resetDatabase.js
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../database/cofounder.db');

// Delete existing database
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('Existing database deleted');
}

// Reinitialize with correct schema
const DatabaseService = require('../services/databaseService');
console.log('Database reset complete');
