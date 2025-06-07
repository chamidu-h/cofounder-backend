// routes/jobRoutes.js
const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');

// Route to get all job listings
router.get('/', jobController.getAllJobs);

// A route to trigger the import. Secure this in a real app!
router.post('/import', jobController.importJobs);

module.exports = router;
