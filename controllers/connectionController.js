// The entire module is now a factory function that accepts the 'db' instance.
module.exports = (db) => ({

    sendRequest: async (req, res) => {
        const requesterId = req.user.userId;
        const { addresseeId } = req.body;

        if (!addresseeId) {
            return res.status(400).json({ error: "Addressee ID is required." });
        }
        const numericAddresseeId = parseInt(addresseeId, 10);
        if (isNaN(numericAddresseeId)) {
            return res.status(400).json({ error: "Addressee ID must be a number." });
        }
        if (requesterId === numericAddresseeId) {
            return res.status(400).json({ error: "Cannot connect with yourself." });
        }

        try {
            // Use the injected 'db' object for all database operations
            const existingStatus = await db.getConnectionStatus(requesterId, numericAddresseeId);
            if (existingStatus) {
                return res.status(400).json({ error: `A connection or request already exists with status: ${existingStatus.status}.` });
            }

            const connection = await db.createConnectionRequest(requesterId, numericAddresseeId);
            res.status(201).json({ message: "Connection request sent.", connection });

        } catch (error) {
            console.error("Error sending connection request:", error);
            if (error.code === '23505' || error.constraint === 'uq_connection_pair') {
                return res.status(400).json({ error: "Connection request already exists." });
            }
            res.status(500).json({ error: "Failed to send connection request" });
        }
    },

    getPendingRequests: async (req, res) => {
        const userId = req.user.userId;
        try {
            // Use the injected 'db' object
            const requests = await db.getPendingRequestsForUser(userId);
            res.json({ pendingRequests: requests });
        } catch (error) {
            console.error("Error fetching pending requests:", error);
            res.status(500).json({ error: "Failed to fetch pending requests" });
        }
    },

    getSentRequests: async (req, res) => {
        const userId = req.user.userId;
        try {
            // Use the injected 'db' object
            const requests = await db.getSentRequestsByUser(userId);
            res.json({ sentRequests: requests });
        } catch (error) {
            console.error("Error fetching sent requests:", error);
            res.status(500).json({ error: "Failed to fetch sent requests" });
        }
    },

    acceptRequest: async (req, res) => {
        const addresseeId = req.user.userId;
        const { requesterId } = req.body;

        if (!requesterId) {
            return res.status(400).json({ error: "Requester ID is required in the request body." });
        }
        const numericRequesterId = parseInt(requesterId, 10);
        if (isNaN(numericRequesterId)) {
            return res.status(400).json({ error: "Requester ID must be a number." });
        }

        try {
            // Use the injected 'db' object
            const connection = await db.acceptConnectionRequest(numericRequesterId, addresseeId);
            if (!connection) {
                return res.status(404).json({ error: "Pending request not found, already actioned, or you are not the addressee." });
            }
            res.json({ message: "Connection request accepted.", connection });
        } catch (error) {
            console.error("Error accepting connection request:", error);
            res.status(500).json({ error: "Failed to accept connection request" });
        }
    },

    declineOrCancelRequest: async (req, res) => {
        const currentUserId = req.user.userId;
        const connectionId = parseInt(req.params.connectionId, 10);

        if (isNaN(connectionId)) {
            return res.status(400).json({ error: "Valid connection ID is required." });
        }

        try {
            // Use the injected 'db' object
            const rowCount = await db.declineOrCancelConnectionRequest(connectionId, currentUserId);
            if (rowCount === 0) {
                return res.status(404).json({ error: "Pending request not found or you are not authorized to perform this action." });
            }
            res.json({ message: "Connection request declined/cancelled successfully." });
        } catch (error) {
            console.error("Error declining/cancelling request:", error);
            res.status(500).json({ error: "Failed to decline/cancel request" });
        }
    },

    getActiveConnections: async (req, res) => {
        const userId = req.user.userId;
        try {
            // Use the injected 'db' object
            const connections = await db.getActiveConnections(userId);
            res.json({ activeConnections: connections });
        } catch (error) {
            console.error("Error fetching active connections:", error);
            res.status(500).json({ error: "Failed to fetch active connections" });
        }
    },
    
    // --- ADDED METHOD ---
    // Provides the logic for checking the connection status between two users.
    getStatus: async (req, res) => {
        const currentUserId = req.user.userId;
        const viewedUserId = parseInt(req.params.viewedUserId, 10);

        if (isNaN(viewedUserId)) {
            return res.status(400).json({ error: "A valid numeric user ID must be provided in the URL." });
        }
        
        // Prevent checking status with oneself, which should not happen but is good practice.
        if (currentUserId === viewedUserId) {
             return res.json({ status: 'self' }); // Or null, depending on desired frontend logic.
        }

        try {
            // This reuses the same database function that sendRequest uses to check for existing connections.
            const connection = await db.getConnectionStatus(currentUserId, viewedUserId);

            if (!connection) {
                // No connection record exists, so the status is null.
                return res.json({ status: null });
            }

            // A connection was found, return its status (e.g., 'pending', 'accepted').
            return res.json({ status: connection.status });

        } catch (error) {
            console.error("Error in getStatus controller:", error);
            res.status(500).json({ error: "Server error while fetching connection status." });
        }
    }
});
