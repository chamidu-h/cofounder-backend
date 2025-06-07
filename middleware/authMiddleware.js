// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ message: 'Authentication token is required.' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
        console.error('[FATAL AUTH] JWT_SECRET environment variable is not set.');
    }

    jwt.verify(token, secret || 'your-insecure-fallback-key', (err, userPayload) => {
        if (err) {
            console.warn(`[AUTH] Token verification failed: ${err.message}`);
            return res.status(403).json({ message: 'Token is invalid or has expired. Please log in again.' });
        }

        // --- ENHANCED LOGGING ---
        console.log(`[AUTH] Token verified. Payload attached to req.user:`, userPayload);

        req.user = userPayload;
        next();
    });
};

module.exports = {
    authenticateToken,
    ensureAuthenticated: authenticateToken
};
