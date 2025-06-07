// server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path'); // For path.join
const fs = require('fs');    // For fs.mkdirSync and fs.existsSync

// Load environment variables from .env file (primarily for local development)
dotenv.config();

const app = express();

// Robust Port Selection Logic
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
      `[ERROR] Invalid PORT environment variable received: "${portStringFromEnv}". ` +
      `It must be a string representing an integer between 1 and 65535. ` +
      `Falling back to default port ${localDefaultPort}. ` +
      `If on a hosting platform like Railway, check their PORT variable injection and remove any manual PORT overrides in your service settings.`
    );
    portToListenOn = localDefaultPort;
  }
} else {
  portToListenOn = localDefaultPort;
  console.log(
    `[INFO] PORT environment variable not set. Using default port ${portToListenOn} for local development.`
  );
}
// End of Port Selection Logic

// Middleware
const corsOptions = {
  origin: process.env.FRONTEND_URL || "*", // Be more specific in production
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
console.log(`[INFO] CORS configured for origin: ${corsOptions.origin}`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SQLite Specific Directory Creation (harmless if not using SQLite)
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
// End of SQLite Specific Directory Creation

// Mount routes
try {
  const authRoutes = require('./routes/authRoutes');
  const profileRoutes = require('./routes/profileRoutes');
  const jobRoutes = require('./routes/jobRoutes');

  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/jobs', jobRoutes);
  console.log("[INFO] API routes mounted: /api/auth, /api/profile");
} catch (routeError) {
  console.error("[FATAL] Error loading routes. Application might not work correctly:", routeError);
  // Consider exiting: process.exit(1);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), message: 'Backend is healthy' });
});

// Initialize database service (if its constructor handles initialization)
// const databaseService = require('./services/databaseService'); // Ensure this is instantiated

const host = '0.0.0.0'; // Listen on all available interfaces

app.listen(portToListenOn, host, () => {
  console.log(`Server running on host ${host} and port ${portToListenOn}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Consider graceful shutdown: process.exit(1);
});
