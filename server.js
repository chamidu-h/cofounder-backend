// server.js

// --- MODULE IMPORTS ---
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// --- 1. Import the Singleton DB Instance and all Module Factories ---
const db = require('./services/databaseService');
const authMiddleware = require('./middleware/authMiddleware');

const createAuthController = require('./controllers/authController');
const createProfileController = require('./controllers/profileController');
const createSuggestionController = require('./controllers/suggestionController');
const createConnectionController = require('./controllers/connectionController');
const createJobController = require('./controllers/jobController');
const createCvController = require('./controllers/cvController');

const createAuthRoutes = require('./routes/authRoutes');
const createProfileRoutes = require('./routes/profileRoutes');
const createJobRoutes = require('./routes/jobRoutes');
const createCvRoutes = require('./routes/cvRoutes');

// --- INITIAL SETUP ---
dotenv.config();
const app = express();

// --- PORT SELECTION LOGIC (Unchanged) ---
let portToListenOn;
const portStringFromEnv = process.env.PORT;
const localDefaultPort = 5000;
if (portStringFromEnv) {
    const parsedPort = parseInt(portStringFromEnv, 10);
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
        portToListenOn = parsedPort;
        console.log(`[INFO] Using PORT from environment variable: ${portToListenOn}`);
    } else {
        console.error(`[ERROR] Invalid PORT environment variable: "${portStringFromEnv}". Falling back to default port ${localDefaultPort}.`);
        portToListenOn = localDefaultPort;
    }
} else {
    portToListenOn = localDefaultPort;
    console.log(`[INFO] PORT environment variable not set. Using default port ${portToListenOn} for local development.`);
}

// --- MIDDLEWARE CONFIGURATION (Unchanged) ---
const corsOptions = {
    origin: process.env.FRONTEND_URL || "*",
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
console.log(`[INFO] CORS configured for origin: ${corsOptions.origin}`);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- FILE SYSTEM SETUP (Unchanged, harmless) ---
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
    try { fs.mkdirSync(dbDir); console.log(`[INFO] Created directory: ${dbDir}`); }
    catch (err) { console.error(`[ERROR] Could not create directory ${dbDir}:`, err); }
} else {
    console.log(`[INFO] Directory already exists: ${dbDir}`);
}

// --- ASYNCHRONOUS SERVER STARTUP FUNCTION ---
async function startServer() {
    try {
        // --- 2. Connect and initialize DB first. This MUST be the first async step. ---
        console.log('[STARTUP] Initializing database connection...');
        await db.connect();
        if (!db.pool) {
            throw new Error("Database connection failed during startup.");
        }
        console.log('[STARTUP] Database initialization complete.');

        // --- 3. Create controllers by INJECTING the 'db' instance. ---
        console.log('[STARTUP] Initializing controllers...');
        const authController = createAuthController(db);
        const profileController = createProfileController(db);
        const suggestionController = createSuggestionController(db);
        const connectionController = createConnectionController(db);
        const jobController = createJobController(db);
        const cvController = createCvController(db);

        // --- 4. Mount routes by INJECTING controllers and middleware. ---
        console.log("[STARTUP] Mounting API routes...");
        app.use('/api/auth', createAuthRoutes(authController, authMiddleware));
        app.use('/api/profile', createProfileRoutes(profileController, suggestionController, connectionController, authMiddleware));
        app.use('/api/jobs', createJobRoutes(jobController, authMiddleware));
        app.use('/api/cv', createCvRoutes(cvController, authMiddleware));
        console.log("[INFO] All API routes mounted successfully.");

        // --- HEALTH CHECK ENDPOINT ---
        app.get('/api/health', (req, res) => {
            res.json({
                status: 'OK',
                timestamp: new Date().toISOString(),
                database: db.pool ? 'connected' : 'disconnected'
            });
        });

        // --- 5. Start the Express server only after everything is configured. ---
        const host = '0.0.0.0';
        app.listen(portToListenOn, host, () => {
            console.log(`[SUCCESS] Server is running on host ${host} and listening on port ${portToListenOn}`);
        });

    } catch (error) {
        console.error('[FATAL] Failed to start server:', error);
        process.exit(1); // Exit the process with an error code if startup fails
    }
}

// --- GLOBAL ERROR HANDLERS (Unchanged) ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// --- INITIATE SERVER STARTUP ---
startServer();
