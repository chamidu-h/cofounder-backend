// server.js

// --- MODULE IMPORTS ---
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./services/databaseService'); // Import the singleton instance

// --- INITIAL SETUP ---
// Load environment variables from .env file (primarily for local development)
dotenv.config();

const app = express();


// --- PORT SELECTION LOGIC ---
let portToListenOn;
const portStringFromEnv = process.env.PORT; // This is provided by Railway (and other hosts)
const localDefaultPort = 5000; // Your fallback for local development

if (portStringFromEnv) {
  const parsedPort = parseInt(portStringFromEnv, 10);
  if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    portToListenOn = parsedPort;
    console.log(`[INFO] Using PORT from environment variable: ${portToListenOn}`);
  } else {
    console.error(
      `[ERROR] Invalid PORT environment variable: "${portStringFromEnv}". Falling back to default port ${localDefaultPort}.`
    );
    portToListenOn = localDefaultPort;
  }
} else {
  portToListenOn = localDefaultPort;
  console.log(`[INFO] PORT environment variable not set. Using default port ${portToListenOn} for local development.`);
}
// End of Port Selection Logic


// --- MIDDLEWARE CONFIGURATION ---
const corsOptions = {
  origin: process.env.FRONTEND_URL || "*", // It's better to be specific in production, e.g., 'https://your-app.vercel.app'
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
console.log(`[INFO] CORS configured for origin: ${corsOptions.origin}`);

app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded


// --- FILE SYSTEM SETUP (for SQLite, harmless otherwise) ---
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


// --- API ROUTES MOUNTING ---
try {
  const authRoutes = require('./routes/authRoutes');
  const profileRoutes = require('./routes/profileRoutes');
  const jobRoutes = require('./routes/jobRoutes'); // Make sure this file exists

  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/jobs', jobRoutes); // Mount the new job routes
  console.log("[INFO] API routes mounted: /api/auth, /api/profile, /api/jobs");
} catch (routeError) {
  console.error("[FATAL] Error loading routes. Application will not start correctly.", routeError);
  process.exit(1); // Exit if routes can't be loaded, as the app is non-functional
}


// --- HEALTH CHECK ENDPOINT ---
app.get('/api/health', (req, res) => {
  const dbStatus = db.pool ? 'connected' : 'disconnected';
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    message: 'Backend is healthy'
  });
});


// --- ASYNCHRONOUS SERVER STARTUP FUNCTION ---
async function startServer() {
  try {
    // 1. Connect to and initialize the database. The server will wait for this to complete.
    console.log('[STARTUP] Initializing database connection...');
    await db.connect(); // This function now handles initialization

    if (!db.pool) {
        console.error("[FATAL] Database connection failed. Server will not start.");
        process.exit(1); // Exit if the database connection fails
    }
    console.log('[STARTUP] Database initialization complete.');

    // 2. Start the Express server only after the database is ready.
    const host = '0.0.0.0'; // Listen on all available network interfaces
    app.listen(portToListenOn, host, () => {
      console.log(`[SUCCESS] Server is running on host ${host} and listening on port ${portToListenOn}`);
    });

  } catch (error) {
    console.error('[FATAL] Failed to start server:', error);
    process.exit(1); // Exit the process with an error code if startup fails
  }
}


// --- GLOBAL ERROR HANDLERS ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Optional: Gracefully shutdown on unhandled rejections
  // process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Mandatory: Gracefully shutdown on uncaught exceptions, as the application state is unreliable
  process.exit(1);
});


// --- INITIATE SERVER STARTUP ---
startServer();
