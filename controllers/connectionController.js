// controllers/connectionController.js
const databaseService = require('../services/databaseService');

exports.sendRequest = async (req, res) => {
    const requesterId = req.user.userId; // From JWT
    const { addresseeId } = req.body; 

    if (!addresseeId) {
        return res.status(400).json({ error: "Addressee ID is required." });
    }
    // Ensure addresseeId is an integer if it comes as a string
    const numericAddresseeId = parseInt(addresseeId, 10);
    if (isNaN(numericAddresseeId)) {
        return res.status(400).json({ error: "Addressee ID must be a number." });
    }

    if (requesterId === numericAddresseeId) {
        return res.status(400).json({ error: "Cannot connect with yourself." });
    }

    try {
        const existingStatus = await databaseService.getConnectionStatus(requesterId, numericAddresseeId);
        if (existingStatus) {
            return res.status(400).json({ error: `A connection or request already exists with status: ${existingStatus}.` });
        }

        const connection = await databaseService.createConnectionRequest(requesterId, numericAddresseeId);
        res.status(201).json({ message: "Connection request sent.", connection });
    } catch (error) {
        console.error("Error sending connection request:", error);
        // PostgreSQL unique constraint violation error code is '23505'
        if (error.code === '23505' || error.constraint === 'uq_connection_pair') {
             return res.status(400).json({ error: "Connection request already exists." });
        }
        res.status(500).json({ error: "Failed to send connection request" });
    }
};

exports.getPendingRequests = async (req, res) => { // Incoming requests
    const userId = req.user.userId;
    try {
        const requests = await databaseService.getPendingRequestsForUser(userId);
        res.json({ pendingRequests: requests });
    } catch (error) {
        console.error("Error fetching pending requests:", error);
        res.status(500).json({ error: "Failed to fetch pending requests" });
    }
};

exports.getSentRequests = async (req, res) => { // Outgoing requests
    const userId = req.user.userId;
    try {
        const requests = await databaseService.getSentRequestsByUser(userId);
        res.json({ sentRequests: requests });
    } catch (error) {
        console.error("Error fetching sent requests:", error);
        res.status(500).json({ error: "Failed to fetch sent requests" });
    }
};

exports.acceptRequest = async (req, res) => {
    const addresseeId = req.user.userId; // The current user is accepting the request
    const { requesterId } = req.body; // The ID of the user who sent the request

    if (!requesterId) {
        return res.status(400).json({error: "Requester ID is required in the request body."});
    }
    const numericRequesterId = parseInt(requesterId, 10);
     if (isNaN(numericRequesterId)) {
        return res.status(400).json({ error: "Requester ID must be a number." });
    }

    try {
        const connection = await databaseService.acceptConnectionRequest(numericRequesterId, addresseeId);
        if (!connection) {
            return res.status(404).json({ error: "Pending request not found, already actioned, or you are not the addressee." });
        }
        res.json({ message: "Connection request accepted.", connection });
    } catch (error) {
        console.error("Error accepting connection request:", error);
        res.status(500).json({ error: "Failed to accept connection request" });
    }
};

exports.declineOrCancelRequest = async (req, res) => {
    const currentUserId = req.user.userId;
    const connectionId = parseInt(req.params.connectionId, 10); // Get ID from route parameter

    if (isNaN(connectionId)) {
        return res.status(400).json({ error: "Valid connection ID is required." });
    }

    try {
        const deletedCount = await databaseService.declineOrCancelConnectionRequest(connectionId, currentUserId);
        if (deletedCount === 0) {
             return res.status(404).json({ error: "Pending request not found or you are not authorized to perform this action." });
        }
        res.json({ message: "Connection request declined/cancelled successfully." });
    } catch (error) {
        console.error("Error declining/cancelling request:", error);
        res.status(500).json({ error: "Failed to decline/cancel request" });
    }
};

exports.getActiveConnections = async (req, res) => {
    const userId = req.user.userId;
    try {
        const connections = await databaseService.getActiveConnections(userId);
        res.json({ activeConnections: connections });
    } catch (error) {
        console.error("Error fetching active connections:", error);
        res.status(500).json({ error: "Failed to fetch active connections" });
    }
};
