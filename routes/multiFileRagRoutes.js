import express from "express";
import multer from "multer";
import RagService from "../service/ragService1.js";
import logger from "../utils/logger.js";
import { retrieveKBChunks } from "../utils/vectorDB.js";
import { UnifiedDocument } from "../model/clientModel.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const router = express.Router();
const ragService = new RagService();

// Configure multer for multiple file uploads with enhanced settings
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Ensure uploads directory exists
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, extension);
        const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
        cb(null, `${file.fieldname}-${sanitizedBaseName}-${uniqueSuffix}${extension}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 20, // Maximum 20 files for batch processing
        fieldSize: 10 * 1024 * 1024, // 10MB field size limit
        fields: 50 // Maximum number of fields
    },
    fileFilter: (req, file, cb) => {
        logger.info(`File upload filter - file: ${file.originalname}, mimetype: ${file.mimetype}, size: ${file.size || 'unknown'}`);
        
        // Supported file types with more comprehensive MIME type checking
        const allowedTypes = [
            'application/pdf',
            'text/plain',
            'text/csv',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/rtf',
            'text/rtf'
        ];
        
        // Also check file extensions as backup
        const allowedExtensions = ['.pdf', '.txt', '.csv', '.doc', '.docx', '.xls', '.xlsx', '.rtf'];
        const fileExtension = path.extname(file.originalname).toLowerCase();
        
        const isMimeTypeAllowed = allowedTypes.includes(file.mimetype);
        const isExtensionAllowed = allowedExtensions.includes(fileExtension);
        
        if (isMimeTypeAllowed || isExtensionAllowed) {
            cb(null, true);
        } else {
            const supportedFormats = "PDF, TXT, CSV, DOC, DOCX, XLS, XLSX, RTF";
            cb(new Error(`Unsupported file type: ${file.mimetype} (${fileExtension}). Supported formats: ${supportedFormats}`), false);
        }
    }
});

// Multi-file upload endpoint
router.post("/upload-multi", upload.array("files", 10), async (req, res) => {
    try {
        logger.info("=== MULTI-FILE UPLOAD REQUEST START ===");
        logger.info(`Files uploaded: ${req.files ? req.files.length : 0}`);
        logger.info(`Request body:`, req.body);

        const { account_id } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        // Parse URLs if provided
        let urls = null;
        if (req.body.urls) {
            try {
                urls = typeof req.body.urls === 'string' ? JSON.parse(req.body.urls) : req.body.urls;
            } catch (e) {
                urls = req.body.urls.split(',').map(url => url.trim()).filter(url => url);
            }
        }

        // Update body with parsed URLs
        const bodyWithUrls = { ...req.body, urls };

        // Call the processing function
        const result = await ragService.processAPI_Insert_Init({
            files: req.files,
            body: bodyWithUrls
        });

        logger.info("Multi-file upload completed successfully");
        res.json(result);

    } catch (error) {
        logger.error("Multi-file upload error:", error);
        res.status(500).json({ 
            success: false,
            error: "Upload processing failed", 
            message: error.message 
        });
    }
});

// Single file upload endpoint (for backward compatibility)
router.post("/upload-single", upload.single("file"), async (req, res) => {
    try {
        logger.info("=== SINGLE FILE UPLOAD REQUEST START ===");
        logger.info(`File uploaded: ${req.file ? req.file.originalname : 'none'}`);
        logger.info(`Request body:`, req.body);

        const { account_id } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        // Convert single file to array format
        const files = req.file ? [req.file] : [];

        const result = await ragService.processAPI_Insert_Init({
            files: files,
            body: req.body
        });

        logger.info("Single file upload completed successfully");
        res.json(result);

    } catch (error) {
        logger.error("Single file upload error:", error);
        res.status(500).json({ 
            success: false,
            error: "Upload processing failed", 
            message: error.message 
        });
    }
});

// URL processing endpoint (no files, just URLs)
router.post("/process-urls", async (req, res) => {
    try {
        logger.info("=== URL PROCESSING REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { account_id, urls } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ 
                success: false,
                error: "urls array is required" 
            });
        }

        const result = await ragService.processAPI_Insert_Init({
            files: [],
            body: req.body
        });

        logger.info("URL processing completed successfully");
        res.json(result);

    } catch (error) {
        logger.error("URL processing error:", error);
        res.status(500).json({ 
            success: false,
            error: "URL processing failed", 
            message: error.message 
        });
    }
});

// Mixed content endpoint (files + URLs + file URLs)
router.post("/process-mixed", upload.array("files", 10), async (req, res) => {
    try {
        logger.info("=== MIXED CONTENT PROCESSING REQUEST START ===");
        logger.info(`Files: ${req.files ? req.files.length : 0}`);
        logger.info(`Request body:`, req.body);

        const { account_id } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        // Parse URLs if provided
        let urls = null;
        if (req.body.urls) {
            try {
                urls = typeof req.body.urls === 'string' ? JSON.parse(req.body.urls) : req.body.urls;
            } catch (e) {
                urls = req.body.urls.split(',').map(url => url.trim()).filter(url => url);
            }
        }

        // Check if at least one input type is provided
        const hasFiles = req.files && req.files.length > 0;
        const hasUrls = urls && urls.length > 0;
        const hasFileUrl = req.body.file_url;

        if (!hasFiles && !hasUrls && !hasFileUrl) {
            return res.status(400).json({ 
                success: false,
                error: "At least one of the following is required: files, urls, or file_url" 
            });
        }

        // Update body with parsed URLs
        const bodyWithUrls = { ...req.body, urls };

        const result = await ragService.processAPI_Insert_Init({
            files: req.files,
            body: bodyWithUrls
        });

        logger.info("Mixed content processing completed successfully");
        res.json(result);

    } catch (error) {
        logger.error("Mixed content processing error:", error);
        res.status(500).json({ 
            success: false,
            error: "Mixed content processing failed", 
            message: error.message 
        });
    }
});

// Enhanced search endpoint with multiple methods and filters
router.post("/search", async (req, res) => {
    try {
        logger.info("=== SEARCH REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { 
            account_id, 
            query, 
            limit = 10, 
            search_method = 'hybrid',
            filters = {},
            include_metadata = true,
            sort_by = 'score',
            sort_order = 'desc'
        } = req.body;

        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!query) {
            return res.status(400).json({ 
                success: false,
                error: "query is required" 
            });
        }

        // Validate search method
        const validMethods = ['vector', 'database', 'keyword', 'hybrid'];
        if (!validMethods.includes(search_method)) {
            return res.status(400).json({ 
                success: false,
                error: `Invalid search_method. Valid options: ${validMethods.join(', ')}` 
            });
        }

        // Use the enhanced search method from ragService
        const results = await ragService.searchDocuments({
            account_id: parseInt(account_id),
            query: query,
            limit: parseInt(limit),
            searchMethod: search_method,
            filters: filters
        });

        // Apply additional sorting if specified
        if (sort_by && sort_by !== 'score') {
            results.sort((a, b) => {
                const aVal = a[sort_by] || 0;
                const bVal = b[sort_by] || 0;
                return sort_order === 'desc' ? bVal - aVal : aVal - bVal;
            });
        }

        // Filter out metadata if not requested
        let processedResults = results;
        if (!include_metadata) {
            processedResults = results.map(result => {
                const { metadata, ...rest } = result;
                return rest;
            });
        }

        logger.info(`Search completed: ${results.length} results found using ${search_method} method`);
        res.json({
            success: true,
            query,
            account_id: parseInt(account_id),
            search_method,
            limit: parseInt(limit),
            results_count: processedResults.length,
            results: processedResults,
            filters,
            sort_by,
            sort_order,
            search_metadata: {
                execution_time: new Date().toISOString(),
                method_used: search_method,
                filters_applied: Object.keys(filters).length > 0,
                metadata_included: include_metadata
            }
        });

    } catch (error) {
        logger.error("Search error:", error);
        res.status(500).json({ 
            success: false,
            error: "Search failed", 
            message: error.message 
        });
    }
});

// Update document endpoint
router.put("/update", async (req, res) => {
    try {
        logger.info("=== UPDATE DOCUMENT REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { account_id, document_id } = req.body;

        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!document_id) {
            return res.status(400).json({ 
                success: false,
                error: "document_id is required" 
            });
        }

        // Call the update service method
        const result = await ragService.processAPI_Update({
            body: req.body
        });

        logger.info(`Update completed for document ${document_id} in account ${account_id}`);
        res.json(result);

    } catch (error) {
        logger.error("Update error:", error);
        res.status(500).json({ 
            success: false,
            error: "Update failed", 
            message: error.message 
        });
    }
});

// Update document status endpoint
router.patch("/status", async (req, res) => {
    try {
        logger.info("=== UPDATE STATUS REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { account_id, document_id, status } = req.body;

        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!document_id) {
            return res.status(400).json({ 
                success: false,
                error: "document_id is required" 
            });
        }

        if (!status) {
            return res.status(400).json({ 
                success: false,
                error: "status is required" 
            });
        }

        // Call the status update service method
        const result = await ragService.updateApiProcess_Status({
            account_id,
            document_id,
            status
        });

        logger.info(`Status updated for document ${document_id} in account ${account_id} to ${status}`);
        res.json(result);

    } catch (error) {
        logger.error("Status update error:", error);
        res.status(500).json({ 
            success: false,
            error: "Status update failed", 
            message: error.message 
        });
    }
});

// Get documents by account with filters
router.get("/documents/:account_id", async (req, res) => {
    try {
        logger.info("=== GET DOCUMENTS REQUEST START ===");
        
        const { account_id } = req.params;
        const {
            source_type,
            file_type,
            date_from,
            date_to,
            limit = 50,
            offset = 0,
            sort_by = 'processing_date',
            sort_order = 'desc'
        } = req.query;

        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        const result = await ragService.getDocumentsByAccount(account_id, {
            source_type,
            file_type,
            date_from,
            date_to,
            limit: parseInt(limit),
            offset: parseInt(offset),
            sort_by,
            sort_order
        });

        logger.info(`Retrieved ${result.documents.length} documents for account ${account_id}`);
        res.json({
            success: true,
            account_id: parseInt(account_id),
            ...result
        });

    } catch (error) {
        logger.error("Get documents error:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to retrieve documents", 
            message: error.message 
        });
    }
});

// Get document statistics
router.get("/stats/:account_id", async (req, res) => {
    try {
        logger.info("=== GET STATS REQUEST START ===");
        
        const { account_id } = req.params;

        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        const stats = await ragService.getDocumentStats(account_id);

        logger.info(`Retrieved stats for account ${account_id}`);
        res.json({
            success: true,
            account_id: parseInt(account_id),
            stats
        });

    } catch (error) {
        logger.error("Get stats error:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to retrieve statistics", 
            message: error.message 
        });
    }
});

// File analysis endpoint - analyze files before upload
router.post("/analyze-files", upload.array("files", 10), async (req, res) => {
    try {
        logger.info("=== FILE ANALYSIS REQUEST START ===");
        logger.info(`Files to analyze: ${req.files ? req.files.length : 0}`);

        const { account_id } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ 
                success: false,
                error: "At least one file is required for analysis" 
            });
        }

        const analysis = [];
        
        for (const file of req.files) {
            try {
                // Calculate file hash
                const fileBuffer = file.buffer || fs.readFileSync(file.path);
                const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
                
                // Check for existing files
                const existingFileByHash = await ragService._checkExistingFileByHash?.(account_id, fileHash, file.originalname);
                const existingFileByName = await ragService._checkExistingFileByName?.(account_id, file.originalname);
                
                let conflict_status = 'new';
                let action_required = 'upload';
                let existing_info = null;
                
                if (existingFileByHash && existingFileByHash.metadata?.file_hash === fileHash) {
                    conflict_status = 'identical_content';
                    action_required = 'skip';
                    existing_info = {
                        document_id: existingFileByHash.document_id,
                        processing_date: existingFileByHash.processing_date,
                        azure_url: existingFileByHash.azure_url
                    };
                } else if (existingFileByName) {
                    conflict_status = 'same_name_different_content';
                    action_required = 'replace_or_version';
                    existing_info = {
                        document_id: existingFileByName.document_id,
                        processing_date: existingFileByName.processing_date,
                        azure_url: existingFileByName.azure_url,
                        version_number: existingFileByName.metadata?.version_number || 1
                    };
                }
                
                analysis.push({
                    fileName: file.originalname,
                    fileSize: file.size,
                    mimeType: file.mimetype,
                    fileHash: fileHash.substring(0, 16) + '...',
                    conflict_status,
                    action_required,
                    existing_info,
                    supported: true
                });
                
            } catch (error) {
                analysis.push({
                    fileName: file.originalname,
                    fileSize: file.size,
                    mimeType: file.mimetype,
                    error: error.message,
                    supported: false
                });
            }
        }

        // Clean up uploaded files after analysis
        req.files.forEach(file => {
            if (file.path && fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        });

        const summary = {
            total_files: analysis.length,
            new_files: analysis.filter(a => a.conflict_status === 'new').length,
            identical_files: analysis.filter(a => a.conflict_status === 'identical_content').length,
            conflicting_files: analysis.filter(a => a.conflict_status === 'same_name_different_content').length,
            unsupported_files: analysis.filter(a => !a.supported).length
        };

        logger.info("File analysis completed successfully");
        res.json({
            success: true,
            account_id: parseInt(account_id),
            analysis,
            summary,
            recommendations: {
                safe_to_upload: summary.unsupported_files === 0 && summary.conflicting_files === 0,
                requires_attention: summary.conflicting_files > 0,
                conflicts_found: summary.conflicting_files > 0 || summary.identical_files > 0
            }
        });

    } catch (error) {
        logger.error("File analysis error:", error);
        res.status(500).json({ 
            success: false,
            error: "File analysis failed", 
            message: error.message 
        });
    }
});

// Health check endpoint
router.get("/health", async (req, res) => {
    try {
        // Basic service health
        const health = {
            success: true,
            service: "Multi-File RAG API",
            version: "2.0.0",
            status: "healthy",
            timestamp: new Date().toISOString(),
            features: {
                multi_file_upload: true,
                batch_processing: true,
                url_processing: !!process.env.FIRECRAWL_API_KEY,
                azure_storage: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
                vector_search: true,
                file_versioning: true,
                conflict_resolution: true,
                file_types: ["PDF", "TXT", "DOC", "DOCX", "XLS", "XLSX"]
            },
            configuration: {
                firecrawl_configured: !!process.env.FIRECRAWL_API_KEY,
                azure_configured: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
                max_file_size: "50MB",
                max_files_per_upload: 20,
                supported_search_methods: ["vector", "database", "keyword", "hybrid"]
            },
            endpoints: {
                upload_multi: "/api/multi-rag/upload-multi",
                upload_single: "/api/multi-rag/upload-single", 
                upload_batch: "/api/multi-rag/upload-batch",
                process_urls: "/api/multi-rag/process-urls",
                process_mixed: "/api/multi-rag/process-mixed",
                analyze_files: "/api/multi-rag/analyze-files",
                search: "/api/multi-rag/search",
                update: "/api/multi-rag/update",
                delete: "/api/multi-rag/document",
                documents: "/api/multi-rag/documents/:account_id",
                stats: "/api/multi-rag/stats/:account_id",
                file_history: "/api/multi-rag/file-history/:account_id/:fileName",
                health: "/api/multi-rag/health"
            }
        };

        // Test database connectivity
        try {
            await UnifiedDocument.countDocuments({});
            health.database_status = "connected";
        } catch (dbError) {
            health.database_status = "error";
            health.database_error = dbError.message;
        }

        logger.info("Health check completed");
        res.json(health);

    } catch (error) {
        logger.error("Health check error:", error);
        res.status(500).json({ 
            success: false,
            service: "Multi-File RAG API",
            status: "unhealthy",
            error: "Health check failed", 
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get file version history endpoint
router.get("/file-history/:account_id/:fileName", async (req, res) => {
    try {
        logger.info("=== GET FILE HISTORY REQUEST START ===");
        
        const { account_id, fileName } = req.params;
        const { includeInactive = 'false' } = req.query;

        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!fileName) {
            return res.status(400).json({ 
                success: false,
                error: "fileName is required" 
            });
        }

        // Decode filename to handle special characters
        const decodedFileName = decodeURIComponent(fileName);
        
        const history = await ragService.getFileVersionHistory(
            account_id, 
            decodedFileName,
            includeInactive === 'true'
        );

        logger.info(`Retrieved version history for file ${decodedFileName} in account ${account_id}`);
        res.json({
            success: true,
            ...history
        });

    } catch (error) {
        logger.error("Get file history error:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to retrieve file history", 
            message: error.message 
        });
    }
});

// Batch file upload with conflict resolution
router.post("/upload-batch", upload.array("files", 20), async (req, res) => {
    try {
        logger.info("=== BATCH FILE UPLOAD REQUEST START ===");
        logger.info(`Files uploaded: ${req.files ? req.files.length : 0}`);
        logger.info(`Request body:`, req.body);

        const { account_id, conflict_resolution = 'auto' } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ 
                success: false,
                error: "At least one file is required for batch upload" 
            });
        }

        // Add conflict resolution strategy to body
        const bodyWithConflictResolution = { 
            ...req.body, 
            conflict_resolution 
        };

        // Use the standard processAPI_Insert_Init method which already handles conflicts
        const result = await ragService.processAPI_Insert_Init({
            files: req.files,
            body: bodyWithConflictResolution
        });

        // Enhance result with batch-specific information
        const batchResult = {
            ...result,
            batch_processing: true,
            conflict_resolution: conflict_resolution,
            batch_summary: {
                total_files: req.files.length,
                new_files: result.results.filter(r => r.status === 'success').length,
                updated_files: result.results.filter(r => r.status === 'updated' || r.status === 'replaced').length,
                skipped_files: result.results.filter(r => r.status === 'skipped_duplicate').length,
                failed_files: result.errors.length
            }
        };

        logger.info("Batch file upload completed successfully");
        res.json(batchResult);

    } catch (error) {
        logger.error("Batch file upload error:", error);
        res.status(500).json({ 
            success: false,
            error: "Batch upload processing failed", 
            message: error.message 
        });
    }
});

// Bulk delete documents endpoint
router.post("/bulk-delete", async (req, res) => {
    try {
        logger.info("=== BULK DELETE REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { account_id, document_ids, deleteFromAzure = true } = req.body;

        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
            return res.status(400).json({ 
                success: false,
                error: "document_ids array is required" 
            });
        }

        const results = [];
        const errors = [];

        // Process each document deletion
        for (const document_id of document_ids) {
            try {
                const result = await ragService.deleteDocument({
                    account_id,
                    document_id,
                    deleteFromAzure: Boolean(deleteFromAzure)
                });
                
                results.push({
                    document_id,
                    status: 'deleted',
                    ...result
                });
                
            } catch (error) {
                logger.error(`Error deleting document ${document_id}:`, error);
                errors.push({
                    document_id,
                    error: error.message,
                    status: 'failed'
                });
            }
        }

        logger.info(`Bulk delete completed: ${results.length} successful, ${errors.length} failed`);
        res.json({
            success: true,
            account_id: parseInt(account_id),
            operation: 'bulk_delete',
            total_requested: document_ids.length,
            successful_deletions: results.length,
            failed_deletions: errors.length,
            results,
            errors
        });

    } catch (error) {
        logger.error("Bulk delete error:", error);
        res.status(500).json({ 
            success: false,
            error: "Bulk delete failed", 
            message: error.message 
        });
    }
});

// Delete document endpoint (enhanced)
router.delete("/document", async (req, res) => {
    try {
        logger.info("=== DELETE DOCUMENT REQUEST START ===");
        logger.info(`Request body:`, req.body);

        const { account_id, document_id, deleteFromAzure = true } = req.body;

        if (!account_id) {
            return res.status(400).json({ 
                success: false,
                error: "account_id is required" 
            });
        }

        if (!document_id) {
            return res.status(400).json({ 
                success: false,
                error: "document_id is required" 
            });
        }

        // Call the delete service method
        const result = await ragService.deleteDocument({
            account_id,
            document_id,
            deleteFromAzure: Boolean(deleteFromAzure)
        });

        logger.info(`Delete completed for document ${document_id} in account ${account_id}`);
        res.json(result);

    } catch (error) {
        logger.error("Delete error:", error);
        res.status(500).json({ 
            success: false,
            error: "Delete failed", 
            message: error.message 
        });
    }
});

export default router;
