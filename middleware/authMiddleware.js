// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

/**
 * Express middleware to authenticate a user via JWT.
 * It expects a token in the 'Authorization' header in the format 'Bearer TOKEN'.
 * If the token is valid, it attaches the decoded user payload to `req.user` and calls next().
 * If the token is missing or invalid, it sends a 401 or 403 response.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Extract the token from the "Bearer <token>" format
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        // No token provided in the header
        return res.status(401).json({ message: 'Authentication token is required.' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
        console.error('[FATAL AUTH] JWT_SECRET environment variable is not set. Authentication is insecure.');
        // In a strict production environment, you might want to fail completely.
        // For now, we will proceed but log a critical error.
    }

    jwt.verify(token, secret || 'your-insecure-fallback-key', (err, userPayload) => {
        if (err) {
            // This can happen if the token is expired or malformed
            console.warn(`[AUTH] Token verification failed: ${err.message}`);
            return res.status(403).json({ message: 'Token is invalid or has expired. Please log in again.' });
        }

        // IMPORTANT: Attach the decoded payload to the request object.
        // Your controllers will access user info via `req.user`.
        req.user = userPayload;

        // Proceed to the next middleware or the route handler
        next();
    });
};

// Export the middleware.
// We provide an alias `ensureAuthenticated` for consistency in case it's used elsewhere.
module.exports = {
    authenticateToken,
    ensureAuthenticated: authenticateToken
};
