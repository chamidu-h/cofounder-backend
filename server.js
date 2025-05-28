// server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path'); // For path.join
const fs = require('fs');    // For fs.mkdirSync and fs.existsSync

// Load environment variables from .env file (primarily for local development)
dotenv.config();

const app = express();

// --- Robust Port Selection Logic ---
let portToListenOn;
const portStringFromEnv = process.env.PORT; // This is provided by Railway (and other hosts)
const localDefaultPort = 5000; // Your fallback for local development

if (portStringFromEnv) {
    const parsedPort = parseInt(portStringFromEnv, 10);

    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
        portToListenOn = parsedPort;
        console.log(`[INFO] Using PORT from environment variable: ${portToListenOn}`);
    } else {
        // This case indicates an invalid PORT was provided in the environment.
        // This is very unusual for Railway, which should provide a valid numeric string.
        console.error(
            `[ERROR] Invalid PORT environment variable received: "${portStringFromEnv}". ` +
            `It must be a string representing an integer between 1 and 65535. ` +
            `Falling back to default port ${localDefaultPort}. ` +
            `If on a hosting platform like Railway, check their PORT variable injection and remove any manual PORT overrides in your service settings.`
        );
        portToListenOn = localDefaultPort;
    }
} else {
    // No PORT environment variable set (e.g., running locally without .env or PORT in .env)
    portToListenOn = localDefaultPort;
    console.log(
        `[INFO] PORT environment variable not set. Using default port ${portToListenOn} for local development.`
    );
}
// --- End of Port Selection Logic ---

// Middleware
// Ensure CORS is configured correctly for your frontend's production URL.
// The FRONTEND_URL should be an environment variable.
const corsOptions = {
  origin: process.env.FRONTEND_URL || "*", // Be more specific in production, e.g., https://your-frontend.vercel.app
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
console.log(`[INFO] CORS configured for origin: ${corsOptions.origin}`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- SQLite Specific Directory Creation ---
// This block is for creating the 'database' directory, likely for a local SQLite file.
// If you are exclusively using PostgreSQL on Railway, this section might be irrelevant
// for the production database itself, but it doesn't harm anything by being here.
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
    try {
        fs.mkdirSync(dbDir);
        console.log(`[INFO] Created directory: ${dbDir}`);
    } catch (err) {
        console.error(`[ERROR] Could not create directory ${dbDir}:`, err);
    }
} else {
    console.log(`[INFO] Directory already exists: ${dbDir}`);
}
// --- End of SQLite Specific Directory Creation ---

// Mount routes
// Make sure these files exist and export Express routers.
try {
    const authRoutes = require('./routes/authRoutes');
    const profileRoutes = require('./routes/profileRoutes'); // Ensure this is './routes/profileRoutes' if it's in the routes folder

    app.use('/api/auth', authRoutes);
    app.use('/api/profile', profileRoutes);
    console.log("[INFO] API routes mounted: /api/auth, /api/profile");
} catch (routeError) {
    console.error("[FATAL] Error loading routes. Application might not work correctly:", routeError);
    // Consider exiting if routes are critical and fail to load
    // process.exit(1);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), message: 'Backend is healthy' });
});

app.listen(portToListenOn, () => {
    // This log will now clearly state which port it's using and why.
    console.log(`Server running on port ${portToListenOn}`);
    // If your database initialization is part of the startup, its success log
    // should appear before or after this, e.g., by requiring and instantiating your DatabaseService.
    // Example: const databaseService = require('./services/databaseService');
    // (Assuming databaseService.js handles its own initialization logging)
});

// Optional: Handle unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Application specific logging, throwing an error, or other logic here
  // It's often recommended to gracefully shut down the server here.
  // process.exit(1);
});
