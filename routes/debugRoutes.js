import express from "express";
import multer from "multer";
import logger from "../utils/logger.js";
import fs from "fs";

const router = express.Router();

// Configure multer for debugging uploads
const debugUpload = multer({ 
    dest: "uploads/",
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        logger.info(`Debug upload filter - file:`, JSON.stringify({
            fieldname: file.fieldname,
            originalname: file.originalname,
            encoding: file.encoding,
            mimetype: file.mimetype
        }, null, 2));
        
        if (file.mimetype === "application/pdf" || file.mimetype === "text/plain") {
            cb(null, true);
        } else {
            cb(new Error("Only PDF and TXT files are allowed"), false);
        }
    }
});

// Debug upload endpoint
router.post("/debug-upload", debugUpload.single("file"), async (req, res) => {
    try {
        logger.info("=== DEBUG UPLOAD REQUEST ===");
        logger.info("Headers:", JSON.stringify(req.headers, null, 2));
        logger.info("Body fields:", JSON.stringify(req.body, null, 2));
        
        if (!req.file) {
            logger.error("No file received in request");
            return res.status(400).json({ error: "No file uploaded" });
        }

        logger.info("File object received:", JSON.stringify(req.file, null, 2));
        
        // Check if file exists
        const fileExists = fs.existsSync(req.file.path);
        logger.info(`File exists at ${req.file.path}: ${fileExists}`);
        
        if (fileExists) {
            const stats = fs.statSync(req.file.path);
            logger.info(`File stats:`, {
                size: stats.size,
                isFile: stats.isFile(),
                created: stats.birthtime,
                modified: stats.mtime
            });
            
            // Try to read first few bytes
            const buffer = fs.readFileSync(req.file.path);
            logger.info(`File buffer length: ${buffer.length}`);
            logger.info(`First 100 bytes: ${buffer.subarray(0, 100).toString('hex')}`);
        }
        
        res.json({
            success: true,
            file: req.file,
            fileExists,
            message: "Debug upload successful - check server logs for details"
        });
        
    } catch (error) {
        logger.error("Debug upload error:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
