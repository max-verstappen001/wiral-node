import multer from 'multer';
import { BlobServiceClient } from '@azure/storage-blob';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

// Azure Blob Storage configuration
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = process.env.CONTAINER_NAME || 'ragdata';

// Initialize Azure Blob Service Client
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);

// Configure Multer to use memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit per file
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        // Optional: Add file type filtering
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
 * Upload multiple files to Azure Blob Storage
 * @param {Array} files - Array of file objects from multer
 * @returns {Promise<Array>} - Array of uploaded file URLs
 */
async function uploadFilesToAzure(files) {
    try {
        const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

        // Ensure container exists - remove public access setting
        await containerClient.createIfNotExists();

        const uploadPromises = files.map(async (file) => {
            // Generate unique filenames
            const fileExtension = file.originalname.split('.').pop();
            const blobName = `${uuidv4()}-${Date.now()}.${fileExtension}`;

            // Get block blob client
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);

            // Upload file buffer to blob
            await blockBlobClient.uploadData(file.buffer, {
                blobHTTPHeaders: {
                    blobContentType: file.mimetype,
                    blobContentDisposition: `inline; filename="${file.originalname}"`
                },
                metadata: {
                    originalName: file.originalname,
                    uploadDate: new Date().toISOString()
                }
            });

            // Return file information with private URL
            return {
                originalName: file.originalname,
                blobName: blobName,
                url: blockBlobClient.url,
                containerName: CONTAINER_NAME,
                size: file.buffer.length,
                mimetype: file.mimetype
            };
        });

        // Wait for all uploads to complete
        const uploadResults = await Promise.all(uploadPromises);
        return uploadResults;

    } catch (error) {
        console.error('Error uploading files to Azure Blob Storage:', error);
        throw error;
    }
}

/**
 * Express route handler for multi-file upload
 */
const handleMultiFileUpload = (req, res) => {
    // Use multer middleware for multiple files
    upload.array('files', 10)(req, res, async (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
                }
                if (err.code === 'LIMIT_FILE_COUNT') {
                    return res.status(400).json({ error: 'Too many files. Maximum is 10 files.' });
                }
            }
            return res.status(400).json({ error: err.message });
        }

        try {
            // Check if files were uploaded
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No files uploaded.' });
            }

            // Upload files to Azure Blob Storage
            const uploadResults = await uploadFilesToAzure(req.files);

            // Return success response with file URLs
            res.status(200).json({
                success: true,
                message: `Successfully uploaded ${uploadResults.length} file(s)`,
                files: uploadResults
            });

        } catch (error) {
            console.error('Upload error:', error);
            res.status(500).json({
                error: 'Failed to upload files',
                details: error.message
            });
        }
    });
};

/**
 * Alternative function for direct file upload without Express middleware
 * @param {Array} fileObjects - Array of file objects with buffer, originalname, mimetype, size
 * @returns {Promise<Array>} - Array of uploaded file URLs
 */
async function directUploadFiles(fileObjects) {
    return await uploadFilesToAzure(fileObjects);
}

/**
 * Delete file from Azure Blob Storage
 * @param {string} blobName - Name of the blob to delete
 * @returns {Promise<boolean>} - Success status
 */
async function deleteFileFromAzure(blobName) {
    try {
        const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.deleteIfExists();
        return true;
    } catch (error) {
        console.error('Error deleting file from Azure Blob Storage:', error);
        throw error;
    }
}

export {
    handleMultiFileUpload,
    uploadFilesToAzure,
    directUploadFiles,
    deleteFileFromAzure,
    upload // Export multer instance for custom usage
};
