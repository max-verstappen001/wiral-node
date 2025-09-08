import express from "express";
import multer from "multer";
import AzureRagService from "../service/azureRagServiceComplete.js";
import logger from "../utils/logger.js";

const router = express.Router();
const azureRagService = new AzureRagService();

// Configure multer for memory storage (files will be uploaded to Azure)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit per file
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt/;
        const extname = allowedTypes.test(file.originalname.toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images, PDFs, and documents are allowed.'));
        }
    }
});

/**
 * Upload files to Azure and process for RAG
 * POST /api/azure-rag/upload
 */
router.post('/upload', upload.array('files', 10), async (req, res) => {
    try {
        logger.info('Azure RAG upload request received');
        
        const { account_id, inbox_ids, title, description, system_prompt, bot_api_key, api_key } = req.body;
        
        if (!account_id) {
            return res.status(400).json({
                error: 'account_id is required'
            });
        }
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                error: 'No files uploaded'
            });
        }

        logger.info(`Processing ${req.files.length} files for account ${account_id}`);

        const result = await azureRagService.uploadWithAzure({
            files: req.files,
            body: req.body
        });

        res.json(result);

    } catch (error) {
        logger.error('Azure RAG upload error:', error);
        res.status(500).json({
            error: 'Upload failed',
            details: error.message
        });
    }
});

/**
 * List files for an account
 * GET /api/azure-rag/files/:accountId
 */
router.get('/files/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        
        const files = await azureRagService.listAccountFiles(accountId);
        
        res.json({
            success: true,
            account_id: accountId,
            files: files,
            count: files.length
        });

    } catch (error) {
        logger.error('List files error:', error);
        res.status(500).json({
            error: 'Failed to list files',
            details: error.message
        });
    }
});

/**
 * Delete file and its embeddings
 * DELETE /api/azure-rag/files/:accountId/:blobName
 */
router.delete('/files/:accountId/:blobName', async (req, res) => {
    try {
        const { accountId, blobName } = req.params;
        
        const result = await azureRagService.deleteAzureFile({
            account_id: accountId,
            blobName: blobName
        });
        
        res.json({
            success: true,
            message: `File ${blobName} deleted successfully`,
            deletedEmbeddings: result.deletedEmbeddings
        });

    } catch (error) {
        logger.error('Delete file error:', error);
        res.status(500).json({
            error: 'Failed to delete file',
            details: error.message
        });
    }
});

/**
 * Search documents using embeddings
 * POST /api/azure-rag/search
 */
router.post('/search', async (req, res) => {
    try {
        const { account_id, query, limit = 5 } = req.body;
        
        if (!account_id || !query) {
            return res.status(400).json({
                error: 'account_id and query are required'
            });
        }

        // Import the existing search function from ragService
        const { retrieveKBChunks } = await import('../utils/vectorDB.js');
        
        const results = await retrieveKBChunks(account_id, query, limit);
        
        res.json({
            success: true,
            query: query,
            results: results,
            count: results.length
        });

    } catch (error) {
        logger.error('Search error:', error);
        res.status(500).json({
            error: 'Search failed',
            details: error.message
        });
    }
});

/**
 * Health check for Azure integration
 * GET /api/azure-rag/health
 */
router.get('/health', async (req, res) => {
    try {
        const { BlobServiceClient } = await import('@azure/storage-blob');
        
        // Test Azure connection
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient(process.env.CONTAINER_NAME || 'ragdata');
        
        // Try to access container properties
        await containerClient.getProperties();
        
        res.json({
            success: true,
            message: 'Azure RAG service is healthy',
            azure_connected: true,
            container: process.env.CONTAINER_NAME || 'ragdata',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Azure health check failed:', error);
        res.status(500).json({
            success: false,
            azure_connected: false,
            error: error.message
        });
    }
});

export default router;
