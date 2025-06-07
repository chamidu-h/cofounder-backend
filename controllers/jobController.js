// controllers/jobController.js
const db = require('../services/databaseService');
const path = require('path');

exports.getAllJobs = async (req, res) => {
    try {
        const jobs = await db.getAllJobs();
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch jobs.", error: error.message });
    }
};

// This is an admin-like function to trigger the import
exports.importJobs = async (req, res) => {
    try {
        // In a real app, you might upload the file. For simplicity, we assume the
        // file is already on the server (e.g., in the project directory).
        const excelFilePath = path.resolve(__dirname, '..', 'data', 'xpress_jobs_puppeteer.xlsx');
        console.log(`Attempting to import from: ${excelFilePath}`);

        const result = await db.importJobsFromExcel(excelFilePath);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: "Failed to import jobs.", error: error.message });
    }
};
