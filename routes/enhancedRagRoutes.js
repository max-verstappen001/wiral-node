import express from "express";
import multer from "multer";
import RagService1 from "../service/ragService1.js";
import logger from "../utils/logger.js";

const router = express.Router();
const ragService = new RagService1();

// Configure multer for file uploads with enhanced support
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = file.originalname.split('.').pop();
        cb(null, file.fieldname + '-' + uniqueSuffix + '.' + extension);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit for Excel files
    },
    fileFilter: (req, file, cb) => {
        logger.info(`Enhanced upload filter - file: ${file.originalname}, mimetype: ${file.mimetype}`);
        
        const allowedTypes = [
            "application/pdf",
            "text/plain",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel.sheet.macroEnabled.12"
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Supported file types: PDF, TXT, Excel (XLS, XLSX)"), false);
        }
    }
});

// Enhanced upload endpoint with file and URL support
router.post("/upload-enhanced", upload.array("files", 10), async (req, res) => {
    try {
        logger.info("=== ENHANCED UPLOAD REQUEST START ===");
        logger.info(`Files uploaded: ${req.files ? req.files.length : 0}`);
        logger.info(`Request body:`, req.body);

        const { account_id } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ error: "account_id is required" });
        }

        // Handle upsert operation with enhanced features
        const result = await ragService.upsertDocuments({
            files: req.files,
            body: req.body,
            operation: 'upsert'
        });

        logger.info("Enhanced upload completed successfully");
        res.json(result);

    } catch (error) {
        logger.error("Enhanced upload error:", error);
        res.status(500).json({ 
            error: "Upload failed", 
            message: error.message,
            success: false 
        });
    }
});

// Process URLs using Firecrawl
router.post("/process-urls", async (req, res) => {
    try {
        logger.info("=== URL PROCESSING REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { urls, account_id, firecrawlOptions } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: "URLs array is required" });
        }

        if (!account_id) {
            return res.status(400).json({ error: "account_id is required" });
        }

        const result = await ragService.processUrls({
            urls,
            body: req.body,
            firecrawlOptions: firecrawlOptions || {}
        });

        logger.info("URL processing completed successfully");
        res.json(result);

    } catch (error) {
        logger.error("URL processing error:", error);
        res.status(500).json({ 
            error: "URL processing failed", 
            message: error.message,
            success: false 
        });
    }
});

// Batch URL processing with rate limiting
router.post("/process-batch-urls", async (req, res) => {
    try {
        logger.info("=== BATCH URL PROCESSING REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { urls, account_id, batchSize = 5, delayBetweenBatches = 2000 } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: "URLs array is required" });
        }

        if (!account_id) {
            return res.status(400).json({ error: "account_id is required" });
        }

        const result = await ragService.processBatchUrls({
            urls,
            body: req.body,
            batchSize,
            delayBetweenBatches
        });

        logger.info("Batch URL processing completed successfully");
        res.json(result);

    } catch (error) {
        logger.error("Batch URL processing error:", error);
        res.status(500).json({ 
            error: "Batch URL processing failed", 
            message: error.message,
            success: false 
        });
    }
});

// Enhanced upsert endpoint with mixed content support
router.post("/upsert", upload.array("files", 10), async (req, res) => {
    try {
        logger.info("=== ENHANCED UPSERT REQUEST START ===");
        logger.info(`Files: ${req.files ? req.files.length : 0}, Body:`, req.body);

        const { account_id, urls } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ error: "account_id is required" });
        }

        // Parse URLs if provided as string
        let urlsArray = null;
        if (urls) {
            try {
                urlsArray = typeof urls === 'string' ? JSON.parse(urls) : urls;
            } catch (e) {
                urlsArray = urls.split(',').map(url => url.trim()).filter(url => url);
            }
        }

        const result = await ragService.upsertDocuments({
            files: req.files,
            urls: urlsArray,
            body: req.body,
            operation: req.body.operation || 'upsert'
        });

        logger.info("Enhanced upsert completed successfully");
        res.json(result);

    } catch (error) {
        logger.error("Enhanced upsert error:", error);
        res.status(500).json({ 
            error: "Upsert operation failed", 
            message: error.message,
            success: false 
        });
    }
});

// Enhanced search with source type filtering
router.post("/search-enhanced", async (req, res) => {
    try {
        logger.info("=== ENHANCED SEARCH REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { account_id, query, limit = 10, sourceTypes = [] } = req.body;

        if (!account_id) {
            return res.status(400).json({ error: "account_id is required" });
        }

        if (!query) {
            return res.status(400).json({ error: "query is required" });
        }

        const results = await ragService.searchDocuments({
            account_id,
            query,
            limit,
            sourceTypes
        });

        logger.info(`Enhanced search completed: ${results.length} results found`);
        res.json({
            success: true,
            query,
            account_id,
            limit,
            sourceTypes,
            results_count: results.length,
            results
        });

    } catch (error) {
        logger.error("Enhanced search error:", error);
        res.status(500).json({ 
            error: "Search failed", 
            message: error.message,
            success: false 
        });
    }
});

// Enhanced document listing with statistics
router.get("/documents-enhanced/:accountId", async (req, res) => {
    try {
        logger.info("=== ENHANCED DOCUMENT LISTING REQUEST START ===");
        
        const { accountId } = req.params;
        const { sourceType, includeStats = 'true' } = req.query;

        const result = await ragService.listDocuments({
            account_id: accountId,
            sourceType: sourceType || null,
            includeStats: includeStats === 'true'
        });

        logger.info(`Enhanced document listing completed for account ${accountId}`);
        res.json({
            success: true,
            account_id: accountId,
            sourceType: sourceType || 'all',
            ...result
        });

    } catch (error) {
        logger.error("Enhanced document listing error:", error);
        res.status(500).json({ 
            error: "Failed to list documents", 
            message: error.message,
            success: false 
        });
    }
});

// Health check for enhanced RAG system
router.get("/health-enhanced", async (req, res) => {
    try {
        const health = {
            success: true,
            message: "Enhanced RAG service is healthy",
            features: {
                file_upload: true,
                url_processing: !!process.env.FIRECRAWL_API_KEY,
                excel_support: true,
                azure_integration: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
                batch_processing: true
            },
            supported_file_types: ["PDF", "TXT", "Excel (XLS, XLSX)"],
            firecrawl_configured: !!process.env.FIRECRAWL_API_KEY,
            timestamp: new Date().toISOString()
        };

        logger.info("Enhanced health check completed");
        res.json(health);

    } catch (error) {
        logger.error("Enhanced health check error:", error);
        res.status(500).json({ 
            success: false,
            error: "Health check failed", 
            message: error.message 
        });
    }
});

export default router;
