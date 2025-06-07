// controllers/jobController.js

const path = require('path');

// REMOVED: const db = require('../services/databaseService');

// The entire module is now a factory function that accepts the 'db' instance.
module.exports = (db) => ({

    getAllJobs: async (req, res) => {
        try {
            // Use the injected 'db' object for all database operations
            const jobs = await db.getAllJobs();
            res.json(jobs);
        } catch (error) {
            console.error("Error fetching all jobs:", error);
            res.status(500).json({ message: "Failed to fetch jobs.", error: error.message });
        }
    },

    // This is an admin-like function to trigger the import
    importJobs: async (req, res) => {
        try {
            // This path resolves to the 'data' directory inside your project
            const excelFilePath = path.resolve(__dirname, '..', 'data', 'xpress_jobs_puppeteer.xlsx');
            console.log(`[Importer] Attempting to import from: ${excelFilePath}`);

            // Use the injected 'db' object
            const result = await db.importJobsFromExcel(excelFilePath);
            
            console.log(`[Importer] Import complete. Result:`, result);
            res.status(200).json({ message: "Import process completed successfully.", details: result });

        } catch (error) {
            console.error(`[Importer] Failed to import jobs:`, error);
            res.status(500).json({ message: "Failed to import jobs.", error: error.message });
        }
    }
});
