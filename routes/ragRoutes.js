import express from "express";
import multer from "multer";
import fs from "fs";
import RagService from "../service/ragService.js";
import logger from "../utils/logger.js";

const router = express.Router();
const ragService = new RagService();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = file.originalname.split('.').pop();
        cb(null, file.fieldname + '-' + uniqueSuffix + '.' + extension);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        logger.info(`Upload filter - file: ${file.originalname}, mimetype: ${file.mimetype}`);
        if (file.mimetype === "application/pdf" || file.mimetype === "text/plain") {
            cb(null, true);
        } else {
            cb(new Error("Only PDF and TXT files are allowed"), false);
        }
    }
});

// Upload document endpoint
router.post("/upload", upload.single("file"), async (req, res) => {
    try {
        logger.info("=== UPLOAD REQUEST START ===");
        logger.info(`Request Content-Type: ${req.get('Content-Type')}`);
        logger.info(`Request method: ${req.method}`);
        logger.info(`Request URL: ${req.url}`);
        
        if (!req.file) {
            logger.error("No file uploaded - req.file is null/undefined");
            return res.status(400).json({ error: "No file uploaded" });
        }

        if (!req.body.account_id) {
            logger.error("No account_id provided");
            return res.status(400).json({ error: "account_id is required" });
        }

        // Debug logging
        logger.info("File upload request received:");
        logger.info("File object:", JSON.stringify(req.file, null, 2));
        logger.info("Body:", JSON.stringify(req.body, null, 2));

        // Validate file exists before processing
        if (!req.file.path || !fs.existsSync(req.file.path)) {
            logger.error(`Uploaded file not found at path: ${req.file.path}`);
            return res.status(400).json({ error: "Uploaded file could not be saved" });
        }

        const result = await ragService.upload({
            file: req.file,
            body: req.body
        });

        logger.info(`Document uploaded successfully for account ${req.body.account_id}: ${result.id}`);
        res.json(result);
    } catch (error) {
        logger.error("Error in upload:", error);
        logger.error("Upload error:", error.message);
        logger.error("Stack trace:", error.stack);
        res.status(500).json({ error: error.message });
    }
});

// Delete all data for account
router.delete("/data/:account_id", async (req, res) => {
    try {
        const { account_id } = req.params;
        
        if (!account_id) {
            return res.status(400).json({ error: "account_id is required" });
        }

        const result = await ragService.deleteData({ account_id });
        logger.info(`Data deleted for account ${account_id}`);
        res.json(result);
    } catch (error) {
        logger.error("Delete error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// List documents for account
router.get("/documents/:account_id", async (req, res) => {
    try {
        const { account_id } = req.params;
        
        if (!account_id) {
            return res.status(400).json({ error: "account_id is required" });
        }

        const documents = await ragService.listDocuments({ account_id });
        res.json({ documents });
    } catch (error) {
        logger.error("List documents error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Search documents
router.post("/search", async (req, res) => {
    try {
        const { account_id, query, limit } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ error: "account_id is required" });
        }
        
        if (!query) {
            return res.status(400).json({ error: "query is required" });
        }

        const results = await ragService.searchDocuments({ 
            account_id, 
            query, 
            limit: limit || 10 
        });
        
        res.json({ 
            query,
            results,
            count: results.length 
        });
    } catch (error) {
        logger.error("Search error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Health check for RAG service
router.get("/health", (req, res) => {
    res.json({ 
        status: "OK", 
        service: "RAG Service",
        timestamp: new Date().toISOString() 
    });
});

export default router;
