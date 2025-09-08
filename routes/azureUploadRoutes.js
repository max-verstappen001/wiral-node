import express from 'express';
import { handleMultiFileUpload, uploadFilesToAzure, deleteFileFromAzure } from '../utils/azureFileUpload.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * Azure file upload endpoint
 * POST /api/azure/upload
 * Upload files to Azure Blob Storage
 */
router.post('/upload', (req, res) => {
    logger.info('Azure upload request received');
    handleMultiFileUpload(req, res);
});

/**
 * Upload files for a specific account (for RAG integration)
 * POST /api/azure/upload/:accountId
 */
router.post('/upload/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        logger.info(`Azure upload request for account ${accountId}`);
        
        // Use the existing handleMultiFileUpload but add account metadata
        handleMultiFileUpload(req, res);
        
    } catch (error) {
        logger.error('Azure upload error:', error);
        res.status(500).json({
            error: 'Upload failed',
            details: error.message
        });
    }
});

/**
 * Delete file from Azure
 * DELETE /api/azure/delete/:blobName
 */
router.delete('/delete/:blobName', async (req, res) => {
    try {
        const { blobName } = req.params;
        logger.info(`Deleting blob: ${blobName}`);
        
        const success = await deleteFileFromAzure(blobName);
        
        if (success) {
            res.json({
                success: true,
                message: `File ${blobName} deleted successfully`
            });
        } else {
            res.status(404).json({
                error: 'File not found or already deleted'
            });
        }
        
    } catch (error) {
        logger.error('Azure delete error:', error);
        res.status(500).json({
            error: 'Delete failed',
            details: error.message
        });
    }
});

/**
 * List files in Azure container
 * GET /api/azure/files
 */
router.get('/files', async (req, res) => {
    try {
        const { BlobServiceClient } = await import('@azure/storage-blob');
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient(process.env.CONTAINER_NAME || 'ragdata');
        
        const files = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            files.push({
                name: blob.name,
                size: blob.properties.contentLength,
                lastModified: blob.properties.lastModified,
                contentType: blob.properties.contentType,
                url: `${containerClient.url}/${blob.name}`
            });
        }
        
        res.json({
            success: true,
            files: files,
            count: files.length
        });
        
    } catch (error) {
        logger.error('Azure list files error:', error);
        res.status(500).json({
            error: 'Failed to list files',
            details: error.message
        });
    }
});

export default router;
