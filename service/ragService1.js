import { uploadFilesToAzure, deleteFileFromAzure } from "../utils/azureFileUpload.js";  
import RagUtils from "../utils/ragUtils.js";
import logger from "../utils/logger.js";
import { insertEmbeddings, retrieveKBChunks } from "../utils/vectorDB.js";
import { UnifiedDocument } from "../model/clientModel.js";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import crypto from "crypto";

class RagService {
    constructor() {
        this.ragUtils = new RagUtils();
    }

    async processAPI_Insert_Init({files, body}){
        const { account_id, inbox_ids, title, description, system_prompt, bot_api_key, api_key, urls, file_url } = body;

        try {
            if (!account_id) {
                throw new Error("account_id is required");
            }

            const results = [];
            const errors = [];

            logger.info(`Processing upload request for account ${account_id}`);
            logger.info(`Files: ${files ? files.length : 0}, URLs: ${urls ? urls.length : 0}`);

            // Process files if provided
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileId = uuidv4();
                    
                    try {
                        logger.info(`Processing file ${i + 1}/${files.length}: ${file.originalname}`);

                        // Step 1: Calculate file hash to check for duplicates
                        const fileBuffer = file.buffer || fs.readFileSync(file.path);
                        const fileHash = this._calculateFileHash(fileBuffer);
                        logger.info(`File hash calculated: ${fileHash.substring(0, 16)}...`);

                        // Step 2: Check for existing files
                        const existingFileByHash = await this._checkExistingFileByHash(account_id, fileHash, file.originalname);
                        const existingFileByName = await this._checkExistingFileByName(account_id, file.originalname);
                        
                        let azureUploadResults;
                        let isUpdate = false;
                        let isReplace = false;
                        let oldBlobName = null;
                        let updateReason = null;
                        let oldDocumentId = null;

                        // Logic fix: Handle duplicate detection properly
                        if (existingFileByHash && existingFileByHash.metadata && existingFileByHash.metadata.file_hash === fileHash) {
                            // Exact same file content found - skip
                            logger.info(`File ${file.originalname} has identical content, skipping upload`);
                            
                            results.push({
                                fileId: existingFileByHash.document_id,
                                fileName: file.originalname,
                                azureUrl: existingFileByHash.azure_url,
                                azureBlobName: existingFileByHash.azure_blob_name,
                                documentId: existingFileByHash.document_id,
                                chunksCreated: 0,
                                status: 'skipped_duplicate',
                                type: 'file',
                                message: 'File with identical content already exists'
                            });
                            continue;
                        }

                        // Fix: Better logic for file replacement scenarios
                        if (existingFileByName && (!existingFileByHash || existingFileByName.document_id !== existingFileByHash.document_id)) {
                            // Same filename but different content - replacement scenario
                            logger.info(`File ${file.originalname} exists with different content, will replace existing file`);
                            oldBlobName = existingFileByName.azure_blob_name;
                            oldDocumentId = existingFileByName.document_id;
                            isReplace = true;
                            isUpdate = true;
                            updateReason = 'content_changed';
                        }

                        // Step 3: Upload file to Azure
                        if (isUpdate && oldBlobName) {
                            azureUploadResults = await this._replaceAzureFile(oldBlobName, file);
                            logger.info(`File ${isReplace ? 'replaced' : 'updated'} in Azure: ${azureUploadResults.url}`);
                        } else {
                            azureUploadResults = await this._uploadFileToAzure(file);
                            logger.info(`New file uploaded to Azure: ${azureUploadResults.url}`);
                        }

                        // Step 4: Extract text content
                        const extractedText = await this._extractTextFromFile(file);
                        
                        if (!extractedText || extractedText.trim().length === 0) {
                            throw new Error("No text content could be extracted from the file");
                        }

                        // Step 5: Handle old document cleanup
                        if (isUpdate && oldDocumentId) {
                            logger.info(`${isReplace ? 'Replacing' : 'Updating'} old document records for: ${oldDocumentId}`);
                            
                            // Mark old documents as inactive
                            await UnifiedDocument.updateMany({
                                account_id: parseInt(account_id),
                                document_id: oldDocumentId
                            }, {
                                is_active: false,
                                replaced_date: new Date(),
                                replaced_reason: updateReason,
                                replaced_by: fileId // Use the new fileId
                            });
                            
                            logger.info(`Marked old document ${oldDocumentId} as inactive`);
                        }

                        // Step 6: Process text and generate embeddings
                        const processResult = await this._processTextAndEmbeddings({
                            text: extractedText,
                            account_id,
                            inbox_ids,
                            title: title || file.originalname,
                            description: description || `${isUpdate ? 'Updated' : 'Uploaded'} file: ${file.originalname}`,
                            system_prompt,
                            bot_api_key,
                            api_key,
                            azureInfo: azureUploadResults,
                            fileName: file.originalname,
                            fileId,
                            fileHash,
                            isUpdate
                        });

                        results.push({
                            fileId,
                            fileName: file.originalname,
                            azureUrl: azureUploadResults.url,
                            azureBlobName: azureUploadResults.blobName,
                            documentId: processResult.documentId,
                            chunksCreated: processResult.chunksCreated,
                            status: isUpdate ? (isReplace ? 'replaced' : 'updated') : 'success',
                            type: 'file',
                            isUpdate,
                            isReplace,
                            updateReason,
                            oldDocumentId,
                            fileHash: fileHash.substring(0, 16) + '...',
                            processing: {
                                textLength: extractedText.length,
                                chunks: processResult.chunksCreated,
                                processingTime: processResult.processingTimeMs
                            }
                        });

                        logger.info(`Successfully ${isUpdate ? (isReplace ? 'replaced' : 'updated') : 'processed'} file: ${file.originalname}`);

                    } catch (fileError) {
                        logger.error(`Error processing file ${file.originalname}:`, fileError);
                        errors.push({
                            fileName: file.originalname,
                            error: fileError.message,
                            type: 'file'
                        });
                    }
                }
            }

            // Process URLs if provided
            if (urls && Array.isArray(urls) && urls.length > 0) {
                for (let i = 0; i < urls.length; i++) {
                    const url = urls[i];
                    const urlId = uuidv4();
                    
                    try {
                        logger.info(`Processing URL ${i + 1}/${urls.length}: ${url}`);

                        // Extract text from URL using Firecrawl
                        const extractedText = await this.ragUtils.crawlUrl(url);
                        
                        if (!extractedText || extractedText.trim().length === 0) {
                            throw new Error("No content could be extracted from the URL");
                        }

                        // Process text and generate embeddings
                        const processResult = await this._processTextAndEmbeddings({
                            text: extractedText,
                            account_id,
                            inbox_ids,
                            title: title || `Content from ${url}`,
                            description: description || `Scraped content from ${url}`,
                            system_prompt,
                            bot_api_key,
                            api_key,
                            sourceUrl: url,
                            urlId
                        });

                        results.push({
                            urlId,
                            sourceUrl: url,
                            documentId: processResult.documentId,
                            chunksCreated: processResult.chunksCreated,
                            status: 'success',
                            type: 'url'
                        });

                        logger.info(`Successfully processed URL: ${url}`);

                    } catch (urlError) {
                        logger.error(`Error processing URL ${url}:`, urlError);
                        errors.push({
                            sourceUrl: url,
                            error: urlError.message,
                            type: 'url'
                        });
                    }
                }
            }

            // Process file_url if provided
            if (file_url) {
                try {
                    logger.info(`Processing file URL: ${file_url}`);
                    
                    // Download and process file from URL
                    const downloadedFile = await this._downloadFileFromUrl(file_url);
                    const extractedText = await this._extractTextFromFile(downloadedFile);
                    
                    if (!extractedText || extractedText.trim().length === 0) {
                        throw new Error("No text content could be extracted from the file URL");
                    }

                    const processResult = await this._processTextAndEmbeddings({
                        text: extractedText,
                        account_id,
                        inbox_ids,
                        title: title || `File from ${file_url}`,
                        description: description || `Downloaded file from ${file_url}`,
                        system_prompt,
                        bot_api_key,
                        api_key,
                        sourceUrl: file_url,
                        fileName: path.basename(file_url)
                    });

                    results.push({
                        sourceUrl: file_url,
                        fileName: path.basename(file_url),
                        documentId: processResult.documentId,
                        chunksCreated: processResult.chunksCreated,
                        status: 'success',
                        type: 'file_url'
                    });

                    logger.info(`Successfully processed file URL: ${file_url}`);

                } catch (fileUrlError) {
                    logger.error(`Error processing file URL ${file_url}:`, fileUrlError);
                    errors.push({
                        sourceUrl: file_url,
                        error: fileUrlError.message,
                        type: 'file_url'
                    });
                }
            }

            const totalItems = (files?.length || 0) + (urls?.length || 0) + (file_url ? 1 : 0);

            return {
                success: true,
                message: `Processing completed: ${results.length} successful, ${errors.length} failed`,
                totalItems,
                successCount: results.length,
                errorCount: errors.length,
                results,
                errors,
                account_id: parseInt(account_id)
            };

        } catch (error) {
            logger.error(`Error in processAPI_Insert_Init:`, error);
            throw error;
        }
    }

    // Fixed processAPI_Update method
    async processAPI_Update({body}){
        const { 
            account_id, 
            document_id, 
            title, 
            description, 
            system_prompt, 
            bot_api_key, 
            api_key, 
            inbox_ids,
            content,
            is_active,
            metadata 
        } = body;

        try {
            if (!account_id) {
                throw new Error("account_id is required");
            }

            if (!document_id) {
                throw new Error("document_id is required");
            }

            logger.info(`Processing update request for document ${document_id} in account ${account_id}`);

            // Find the existing document
            const existingDoc = await UnifiedDocument.findOne({
                account_id: parseInt(account_id),
                document_id: document_id,
                is_active: true,
                chunk_index: 0 // Get the first chunk to check original content
            });

            if (!existingDoc) {
                throw new Error(`Document with ID ${document_id} not found for account ${account_id}`);
            }

            logger.info(`Found existing document: ${existingDoc.source_title}`);

            // Prepare update fields
            const updateFields = {
                updatedAt: new Date()
            };

            // Update basic fields if provided
            if (title !== undefined) {
                updateFields.source_title = title;
                updateFields.title = title;
            }
            if (description !== undefined) {
                updateFields.description = description;
            }
            if (system_prompt !== undefined) {
                updateFields.system_prompt = system_prompt;
            }
            if (bot_api_key !== undefined) {
                updateFields.bot_api_key = bot_api_key;
            }
            if (api_key !== undefined) {
                updateFields.api_key = api_key;
            }
            if (inbox_ids !== undefined) {
                updateFields.inbox_ids = Array.isArray(inbox_ids) ? inbox_ids : inbox_ids.split(',').map(id => id.trim());
            }
            if (is_active !== undefined) {
                updateFields.is_active = Boolean(is_active);
            }

            // Update metadata if provided
            if (metadata) {
                const currentMetadata = existingDoc.metadata || {};
                updateFields.metadata = {
                    ...currentMetadata,
                    ...metadata,
                    lastUpdated: new Date()
                };
            }

            // If content is updated, regenerate embeddings
            let contentUpdated = false;
            if (content !== undefined && content !== existingDoc.content) {
                contentUpdated = true;
                logger.info(`Content updated, regenerating embeddings for document ${document_id}`);

                // Split text into chunks
                const textChunks = await this.ragUtils.splitText(content);
                logger.info(`Text split into ${textChunks.length} chunks`);

                // Generate new embeddings
                const embeddings = await this.ragUtils.generateEmbeddings(textChunks);
                logger.info(`Generated ${embeddings.length} embeddings`);

                // Remove ALL existing chunks for this document first
                await UnifiedDocument.deleteMany({
                    account_id: parseInt(account_id),
                    document_id: document_id
                });

                // Create new documents for each chunk
                const documents = [];
                for (let i = 0; i < textChunks.length; i++) {
                    const chunk = textChunks[i];
                    const embedding = embeddings[i];

                    const docEmbedding = {
                        // Core identification
                        account_id: parseInt(account_id),
                        document_id: document_id,
                        chunk_index: i,
                        
                        // Content and embedding
                        content: chunk,
                        pageContent: chunk,
                        embedding: embedding,
                        
                        // Source information from existing doc
                        source_title: updateFields.source_title || existingDoc.source_title,
                        title: updateFields.source_title || existingDoc.source_title,
                        description: updateFields.description || existingDoc.description,
                        source_type: existingDoc.source_type,
                        source_url: existingDoc.source_url,
                        source_uri: existingDoc.source_uri,
                        
                        // File information
                        file_name: existingDoc.file_name,
                        file_type: existingDoc.file_type,
                        file_size: existingDoc.file_size,
                        file_id: existingDoc.file_id,
                        
                        // Azure storage information
                        azure_url: existingDoc.azure_url,
                        azure_blob_name: existingDoc.azure_blob_name,
                        azure_container: existingDoc.azure_container,
                        
                        // URL information
                        url_id: existingDoc.url_id,
                        crawl_date: existingDoc.crawl_date,
                        
                        // Processing information
                        processing_method: 'api',
                        processing_date: new Date(),
                        embedding_model: 'text-embedding-3-small',
                        chunk_method: 'recursive_character',
                        chunk_size: 1000,
                        chunk_overlap: 200,
                        
                        // Bot configuration
                        inbox_ids: updateFields.inbox_ids || existingDoc.inbox_ids,
                        bot_api_key: updateFields.bot_api_key || existingDoc.bot_api_key,
                        api_key: updateFields.api_key || existingDoc.api_key,
                        system_prompt: updateFields.system_prompt || existingDoc.system_prompt,
                        
                        // Metadata
                        metadata: {
                            ...updateFields.metadata,
                            description: updateFields.description || existingDoc.description,
                            content_length: chunk.length,
                            total_content_length: content.length,
                            chunk_position: i + 1,
                            total_chunks: textChunks.length,
                            processing_time_ms: Date.now(),
                            last_updated: new Date(),
                            update_type: 'content_regeneration'
                        },
                        
                        // Status and flags
                        is_active: updateFields.is_active !== undefined ? updateFields.is_active : existingDoc.is_active,
                        is_processed: true,
                        processing_status: 'completed'
                    };

                    documents.push(docEmbedding);
                }

                // Insert new documents
                const insertResult = await UnifiedDocument.insertMany(documents);
                logger.info(`Inserted ${insertResult.length} updated document chunks into MongoDB`);

                // Update vector store
                try {
                    await insertEmbeddings({
                        account_id: parseInt(account_id),
                        chunks: textChunks.map((chunk, index) => ({
                            content: chunk,
                            index: index
                        })),
                        vectors: embeddings,
                        sourceTitle: updateFields.source_title || existingDoc.source_title,
                        sourceUri: existingDoc.source_uri,
                        documentId: document_id
                    });
                    logger.info(`Updated vector store with ${textChunks.length} chunks for document ${document_id}`);
                } catch (vectorError) {
                    logger.error(`Error updating vector store:`, vectorError);
                    // Continue with update even if vector store fails
                }

                return {
                    success: true,
                    message: "Document updated successfully with content regeneration",
                    document_id: document_id,
                    account_id: parseInt(account_id),
                    contentUpdated: true,
                    chunksUpdated: textChunks.length,
                    updatedFields: Object.keys(updateFields)
                };
            } else {
                // No content update - just update metadata and other fields
                const updatedDocs = await UnifiedDocument.updateMany(
                    { 
                        account_id: parseInt(account_id),
                        document_id: document_id
                    },
                    updateFields,
                    { runValidators: true }
                );

                if (updatedDocs.matchedCount === 0) {
                    throw new Error("No documents found to update");
                }

                logger.info(`Updated ${updatedDocs.modifiedCount} document chunks for document ${document_id}`);

                return {
                    success: true,
                    message: "Document metadata updated successfully",
                    document_id: document_id,
                    account_id: parseInt(account_id),
                    contentUpdated: false,
                    chunksUpdated: updatedDocs.modifiedCount,
                    updatedFields: Object.keys(updateFields)
                };
            }

        } catch (error) {
            logger.error(`Error in processAPI_Update:`, error);
            throw error;
        }
    }

    // Fixed helper method to get next version number
    async _getNextVersionNumber(account_id, fileName) {
        try {
            const latestDoc = await UnifiedDocument.findOne({
                account_id: parseInt(account_id),
                file_name: fileName,
                is_active: true // Only check active documents
            }).sort({ 'metadata.version_number': -1, processing_date: -1 });

            if (!latestDoc || !latestDoc.metadata?.version_number) {
                return 1;
            }

            return latestDoc.metadata.version_number + 1;
        } catch (error) {
            logger.error("Error getting next version number:", error);
            return 1;
        }
    }

    // Helper method to calculate file hash
    _calculateFileHash(fileBuffer) {
        return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    }

    // Helper method to check if file with same content already exists
    async _checkExistingFileByHash(account_id, fileHash, fileName) {
        try {
            const existingDoc = await UnifiedDocument.findOne({
                account_id: parseInt(account_id),
                'metadata.file_hash': fileHash,
                file_name: fileName,
                is_active: true
            });
            
            return existingDoc;
        } catch (error) {
            logger.error("Error checking existing file by hash:", error);
            return null;
        }
    }

    // Helper method to check if file with same name already exists
    async _checkExistingFileByName(account_id, fileName) {
        try {
            const existingDoc = await UnifiedDocument.findOne({
                account_id: parseInt(account_id),
                file_name: fileName,
                is_active: true
            }).sort({ processing_date: -1 });
            
            return existingDoc;
        } catch (error) {
            logger.error("Error checking existing file by name:", error);
            return null;
        }
    }

    // Helper method to replace Azure file
    async _replaceAzureFile(oldBlobName, newFile) {
        try {
            // Delete old file from Azure if it exists
            if (oldBlobName) {
                logger.info(`Deleting old Azure file: ${oldBlobName}`);
                await deleteFileFromAzure(oldBlobName);
                logger.info(`Successfully deleted old Azure file: ${oldBlobName}`);
            }

            // Upload new file to Azure
            const newAzureInfo = await this._uploadFileToAzure(newFile);
            logger.info(`Successfully uploaded new file to Azure: ${newAzureInfo.url}`);
            
            return newAzureInfo;
        } catch (error) {
            logger.error("Error replacing Azure file:", error);
            throw error;
        }
    }

    // Helper method to upload file to Azure
    async _uploadFileToAzure(file) {
        try {
            const fileToUpload = {
                originalname: file.originalname,
                buffer: file.buffer || fs.readFileSync(file.path),
                mimetype: file.mimetype || 'application/octet-stream'
            };
            
            const uploadResults = await uploadFilesToAzure([fileToUpload]);
            return uploadResults[0];
        } catch (error) {
            logger.error(`Error uploading file to Azure: ${file.originalname}`, error);
            throw new Error(`Failed to upload file to Azure: ${error.message}`);
        }
    }

    // Helper method to extract text from different file types
    async _extractTextFromFile(file) {
        try {
            const filePath = file.path || file.filepath;
            const fileExtension = path.extname(file.originalname || file.name).toLowerCase();
            
            let extractedText = '';

            switch (fileExtension) {
                case '.pdf':
                    extractedText = await this.ragUtils.extractTextFromPDF(filePath);
                    break;
                case '.txt':
                    extractedText = fs.readFileSync(filePath, 'utf8');
                    break;
                case '.docx':
                case '.doc':
                    extractedText = await this.ragUtils.extractTextFromDocx(filePath);
                    break;
                case '.xlsx':
                case '.xls':
                    extractedText = await this.ragUtils.extractTextFromExcel(filePath);
                    break;
                default:
                    throw new Error(`Unsupported file type: ${fileExtension}`);
            }

            if (!extractedText || extractedText.trim().length === 0) {
                throw new Error("No text content found in the file");
            }

            return extractedText;
        } catch (error) {
            logger.error(`Error extracting text from file:`, error);
            throw error;
        }
    }

    // Fixed helper method to process text and generate embeddings
    async _processTextAndEmbeddings({
        text, 
        account_id, 
        inbox_ids, 
        title, 
        description, 
        system_prompt, 
        bot_api_key, 
        api_key, 
        azureInfo, 
        sourceUrl, 
        fileName, 
        fileId, 
        urlId,
        fileHash = null,
        isUpdate = false
    }) {
        try {
            const startTime = Date.now();
            const documentId = uuidv4();
            
            // Split text into chunks
            const textChunks = await this.ragUtils.splitText(text);
            logger.info(`Text split into ${textChunks.length} chunks`);

            // Generate embeddings for all chunks
            const embeddings = await this.ragUtils.generateEmbeddings(textChunks);
            logger.info(`Generated ${embeddings.length} embeddings`);

            const processingTime = Date.now() - startTime;

            // Determine source type and prepare documents for MongoDB
            const sourceType = sourceUrl ? (fileId ? 'file_url' : 'url') : 'file';
            const documents = [];

            // Get version number for files
            const versionNumber = fileName ? await this._getNextVersionNumber(account_id, fileName) : 1;

            for (let i = 0; i < textChunks.length; i++) {
                const chunk = textChunks[i];
                const embedding = embeddings[i];

                const docEmbedding = {
                    // Core identification
                    account_id: parseInt(account_id),
                    document_id: documentId,
                    chunk_index: i,
                    
                    // Content and embedding
                    content: chunk,
                    embedding: embedding,
                    
                    // Source information
                    source_title: title,
                    source_type: sourceType,
                    source_url: sourceUrl || null,
                    source_uri: azureInfo?.url || sourceUrl || fileName,
                    
                    // File-specific information
                    file_name: fileName || null,
                    file_type: fileName ? path.extname(fileName).toLowerCase() : null,
                    file_id: fileId || null,
                    
                    // Azure storage information
                    azure_url: azureInfo?.url || null,
                    azure_blob_name: azureInfo?.blobName || null,
                    azure_container: azureInfo?.containerName || 'uploads',
                    
                    // URL-specific information
                    url_id: urlId || null,
                    crawl_date: sourceType === 'url' ? new Date() : null,
                    
                    // Processing information
                    processing_method: 'api',
                    processing_date: new Date(),
                    embedding_model: 'text-embedding-3-small',
                    chunk_method: 'recursive_character',
                    chunk_size: 1000,
                    chunk_overlap: 200,
                    
                    // Bot configuration
                    inbox_ids: inbox_ids ? (Array.isArray(inbox_ids) ? inbox_ids : inbox_ids.split(',').map(id => id.trim())) : [],
                    bot_api_key: bot_api_key || null,
                    api_key: api_key || null,
                    system_prompt: system_prompt || null,
                    
                    // Content metadata
                    metadata: {
                        description: description || null,
                        content_length: chunk.length,
                        processing_time_ms: processingTime,
                        extraction_method: sourceType === 'url' ? 'firecrawl' : 'file_parser',
                        total_chunks: textChunks.length,
                        chunk_position: i + 1,
                        file_hash: fileHash,
                        is_update: isUpdate,
                        update_timestamp: isUpdate ? new Date() : null,
                        version_number: versionNumber,
                        additional: {
                            originalTextLength: text.length,
                            compressionRatio: chunk.length / text.length,
                            chunkSizeRatio: chunk.length / 1000
                        }
                    },
                    
                    // Status and flags
                    is_active: true,
                    is_processed: true,
                    processing_status: 'completed',
                    
                    // Legacy compatibility
                    pageContent: chunk,
                    title: title // Legacy alias
                };

                documents.push(docEmbedding);
            }

            // Insert documents into MongoDB
            const insertResult = await UnifiedDocument.insertMany(documents);
            logger.info(`Inserted ${insertResult.length} document embeddings into MongoDB`);

            // Also insert into vector store for similarity search
            const vectorInsertResult = await insertEmbeddings({
                account_id: parseInt(account_id),
                chunks: textChunks.map((chunk, index) => ({
                    content: chunk,
                    index: index
                })),
                vectors: embeddings,
                sourceTitle: title,
                sourceUri: azureInfo?.url || sourceUrl || fileName,
                documentId: documentId
            });

            logger.info(`Inserted ${textChunks.length} embeddings into vector store`);

            return {
                documentId: documentId,
                chunksCreated: textChunks.length,
                embeddingsInserted: insertResult.length,
                processingTimeMs: processingTime,
                mongoInserted: insertResult.length,
                vectorInserted: vectorInsertResult.inserted || textChunks.length
            };

        } catch (error) {
            logger.error(`Error processing text and embeddings:`, error);
            throw error;
        }
    }

    // Helper method to download file from URL
    async _downloadFileFromUrl(fileUrl) {
        try {
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`Failed to download file: ${response.statusText}`);
            }

            const buffer = await response.buffer();
            const fileName = path.basename(fileUrl);
            const tempFilePath = path.join('/tmp', `${uuidv4()}_${fileName}`);
            
            fs.writeFileSync(tempFilePath, buffer);

            return {
                path: tempFilePath,
                originalname: fileName,
                name: fileName
            };

        } catch (error) {
            logger.error(`Error downloading file from URL: ${fileUrl}`, error);
            throw error;
        }
    }

    // Multi-method retrieval function
    async searchDocuments({ account_id, query, limit = 10, searchMethod = 'hybrid', filters = {} }) {
        try {
            logger.info(`Searching documents for account ${account_id} with method: ${searchMethod}`);
            
            switch (searchMethod) {
                case 'vector':
                    // Pure vector similarity search
                    const vectorResults = await retrieveKBChunks({
                        account_id: parseInt(account_id),
                        query,
                        limit
                    });
                    return vectorResults;
                    
                case 'database':
                    // MongoDB text search
                    const dbQuery = {
                        account_id: parseInt(account_id),
                        is_active: true,
                        $text: { $search: query }
                    };
                    
                    // Apply additional filters
                    if (filters.source_type) {
                        dbQuery.source_type = filters.source_type;
                    }
                    if (filters.file_type) {
                        dbQuery.file_type = filters.file_type;
                    }
                    if (filters.date_from) {
                        dbQuery.processing_date = { $gte: new Date(filters.date_from) };
                    }
                    if (filters.date_to) {
                        dbQuery.processing_date = { 
                            ...dbQuery.processing_date, 
                            $lte: new Date(filters.date_to) 
                        };
                    }
                    
                    const dbResults = await UnifiedDocument.find(dbQuery)
                        .sort({ score: { $meta: 'textScore' }, processing_date: -1 })
                        .limit(limit)
                        .lean();
                        
                    return dbResults.map(doc => ({
                        content: doc.content,
                        document_id: doc.document_id,
                        source_title: doc.source_title,
                        source_uri: doc.source_uri,
                        source_type: doc.source_type,
                        score: doc.score || 0,
                        metadata: doc.metadata,
                        chunk_index: doc.chunk_index
                    }));
                    
                case 'keyword':
                    // Keyword-based search in content
                    const keywordQuery = {
                        account_id: parseInt(account_id),
                        is_active: true,
                        content: { $regex: query, $options: 'i' }
                    };
                    
                    const keywordResults = await UnifiedDocument.find(keywordQuery)
                        .sort({ processing_date: -1 })
                        .limit(limit)
                        .lean();
                        
                    return keywordResults.map(doc => ({
                        content: doc.content,
                        document_id: doc.document_id,
                        source_title: doc.source_title,
                        source_uri: doc.source_uri,
                        source_type: doc.source_type,
                        score: this._calculateKeywordScore(doc.content, query),
                        metadata: doc.metadata,
                        chunk_index: doc.chunk_index
                    }));
                    
                case 'hybrid':
                default:
                    // Combine vector search and database search
                    const [vectorRes, dbRes] = await Promise.all([
                        retrieveKBChunks({
                            account_id: parseInt(account_id),
                            query,
                            limit: Math.ceil(limit / 2)
                        }).catch(err => {
                            logger.warn("Vector search failed:", err);
                            return [];
                        }),
                        UnifiedDocument.find({
                            account_id: parseInt(account_id),
                            is_active: true,
                            content: { $regex: query, $options: 'i' }
                        })
                        .sort({ processing_date: -1 })
                        .limit(Math.ceil(limit / 2))
                        .lean()
                        .catch(err => {
                            logger.warn("Database search failed:", err);
                            return [];
                        })
                    ]);
                    
                    // Combine and deduplicate results
                    const combinedResults = [...vectorRes];
                    
                    dbRes.forEach(doc => {
                        const exists = combinedResults.find(r => 
                            r.document_id === doc.document_id && 
                            r.chunk_index === doc.chunk_index
                        );
                        
                        if (!exists) {
                            combinedResults.push({
                                content: doc.content,
                                document_id: doc.document_id,
                                source_title: doc.source_title,
                                source_uri: doc.source_uri,
                                source_type: doc.source_type,
                                score: this._calculateKeywordScore(doc.content, query),
                                metadata: doc.metadata,
                                chunk_index: doc.chunk_index
                            });
                        }
                    });
                    
                    // Sort by score and limit
                    return combinedResults
                        .sort((a, b) => (b.score || 0) - (a.score || 0))
                        .slice(0, limit);
            }
            
        } catch (error) {
            logger.error(`Error in searchDocuments:`, error);
            throw error;
        }
    }

    // Helper method to calculate keyword relevance score
    _calculateKeywordScore(content, query) {
        const queryWords = query.toLowerCase().split(/\s+/);
        const contentWords = content.toLowerCase().split(/\s+/);
        
        let matches = 0;
        queryWords.forEach(word => {
            if (contentWords.includes(word)) {
                matches++;
            }
        });
        
        return matches / queryWords.length;
    }

    // Get documents by various criteria
    async getDocumentsByAccount(account_id, options = {}) {
        try {
            const {
                source_type,
                file_type,
                date_from,
                date_to,
                limit = 50,
                offset = 0,
                sort_by = 'processing_date',
                sort_order = 'desc'
            } = options;

            const query = {
                account_id: parseInt(account_id),
                is_active: true
            };

            if (source_type) query.source_type = source_type;
            if (file_type) query.file_type = file_type;
            if (date_from || date_to) {
                query.processing_date = {};
                if (date_from) query.processing_date.$gte = new Date(date_from);
                if (date_to) query.processing_date.$lte = new Date(date_to);
            }

            const sortObj = {};
            sortObj[sort_by] = sort_order === 'desc' ? -1 : 1;

            const documents = await UnifiedDocument.find(query)
                .sort(sortObj)
                .skip(offset)
                .limit(limit)
                .lean();

            const total = await UnifiedDocument.countDocuments(query);

            return {
                documents,
                total,
                limit,
                offset,
                hasMore: (offset + limit) < total
            };

        } catch (error) {
            logger.error(`Error getting documents by account:`, error);
            throw error;
        }
    }

    // Get document statistics
    async getDocumentStats(account_id) {
        try {
            const stats = await UnifiedDocument.aggregate([
                { $match: { account_id: parseInt(account_id), is_active: true } },
                {
                    $group: {
                        _id: null,
                        totalDocuments: { $sum: 1 },
                        totalChunks: { $sum: 1 },
                        uniqueDocuments: { $addToSet: '$document_id' },
                        sourceTypes: { $addToSet: '$source_type' },
                        fileTypes: { $addToSet: '$file_type' },
                        avgChunkSize: { $avg: '$metadata.content_length' },
                        totalContentLength: { $sum: '$metadata.content_length' },
                        latestUpload: { $max: '$processing_date' },
                        oldestUpload: { $min: '$processing_date' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        totalDocuments: 1,
                        totalChunks: 1,
                        uniqueDocuments: { $size: '$uniqueDocuments' },
                        sourceTypes: 1,
                        fileTypes: 1,
                        avgChunkSize: { $round: ['$avgChunkSize', 2] },
                        totalContentLength: 1,
                        latestUpload: 1,
                        oldestUpload: 1
                    }
                }
            ]);

            return stats[0] || {
                totalDocuments: 0,
                totalChunks: 0,
                uniqueDocuments: 0,
                sourceTypes: [],
                fileTypes: [],
                avgChunkSize: 0,
                totalContentLength: 0,
                latestUpload: null,
                oldestUpload: null
            };

        } catch (error) {
            logger.error(`Error getting document stats:`, error);
            throw error;
        }
    }

    // Delete document and associated Azure files
    async deleteDocument({ account_id, document_id, deleteFromAzure = true }) {
        try {
            if (!account_id || !document_id) {
                throw new Error("account_id and document_id are required");
            }

            logger.info(`Deleting document ${document_id} for account ${account_id}`);

            // Find all chunks for this document
            const documentChunks = await UnifiedDocument.find({
                account_id: parseInt(account_id),
                document_id: document_id
            });

            if (documentChunks.length === 0) {
                return {
                    success: false,
                    message: "Document not found",
                    document_id,
                    account_id: parseInt(account_id)
                };
            }

            // Get Azure blob names for deletion
            const azureBlobNames = [...new Set(
                documentChunks
                    .map(doc => doc.azure_blob_name)
                    .filter(blobName => blobName)
            )];

            // Delete from MongoDB
            const deleteResult = await UnifiedDocument.deleteMany({
                account_id: parseInt(account_id),
                document_id: document_id
            });

            logger.info(`Deleted ${deleteResult.deletedCount} document chunks from MongoDB`);

            // Delete from Azure if requested
            const azureDeleteResults = [];
            if (deleteFromAzure && azureBlobNames.length > 0) {
                for (const blobName of azureBlobNames) {
                    try {
                        await deleteFileFromAzure(blobName);
                        azureDeleteResults.push({ blobName, status: 'deleted' });
                        logger.info(`Deleted Azure file: ${blobName}`);
                    } catch (azureError) {
                        logger.error(`Failed to delete Azure file ${blobName}:`, azureError);
                        azureDeleteResults.push({ 
                            blobName, 
                            status: 'failed', 
                            error: azureError.message 
                        });
                    }
                }
            }

            return {
                success: true,
                message: "Document deleted successfully",
                document_id,
                account_id: parseInt(account_id),
                chunksDeleted: deleteResult.deletedCount,
                azureFilesDeleted: azureDeleteResults.filter(r => r.status === 'deleted').length,
                azureDeleteResults
            };

        } catch (error) {
            logger.error(`Error deleting document:`, error);
            throw error;
        }
    }

    // Get file version history
    async getFileVersionHistory(account_id, fileName, includeInactive = false) {
        try {
            const query = {
                account_id: parseInt(account_id),
                file_name: fileName
            };

            if (!includeInactive) {
                query.is_active = true;
            }

            const versions = await UnifiedDocument.find(query)
                .sort({ 'metadata.version_number': -1, processing_date: -1 })
                .lean();

            const groupedByDocument = {};
            versions.forEach(doc => {
                if (!groupedByDocument[doc.document_id]) {
                    groupedByDocument[doc.document_id] = {
                        document_id: doc.document_id,
                        version_number: doc.metadata?.version_number || 1,
                        file_name: doc.file_name,
                        source_title: doc.source_title,
                        file_hash: doc.metadata?.file_hash,
                        processing_date: doc.processing_date,
                        is_active: doc.is_active,
                        azure_url: doc.azure_url,
                        total_chunks: doc.metadata?.total_chunks || 1,
                        content_length: doc.metadata?.content_length || 0,
                        replaced_date: doc.replaced_date,
                        replaced_reason: doc.replaced_reason,
                        replaced_by: doc.replaced_by,
                        chunks: []
                    };
                }
                groupedByDocument[doc.document_id].chunks.push(doc);
            });

            return {
                fileName,
                account_id: parseInt(account_id),
                versions: Object.values(groupedByDocument),
                totalVersions: Object.keys(groupedByDocument).length,
                activeVersions: Object.values(groupedByDocument).filter(v => v.is_active).length
            };

        } catch (error) {
            logger.error(`Error getting file version history:`, error);
            throw error;
        }
    }

    // Update document processing status
    async updateApiProcess_Status({ account_id, document_id, status }) {
        try {
            if (!account_id || !document_id || !status) {
                throw new Error("account_id, document_id, and status are required");
            }

            const updatedDoc = await UnifiedDocument.updateMany(
                { 
                    account_id: parseInt(account_id),
                    document_id: document_id
                },
                { 
                    processing_status: status,
                    updatedAt: new Date()
                }
            );

            return {
                success: true,
                message: "Status updated successfully",
                document_id: document_id,
                account_id: parseInt(account_id),
                status: status,
                modifiedCount: updatedDoc.modifiedCount
            };

        } catch (error) {
            logger.error(`Error updating document status:`, error);
            throw error;
        }
    }
}

export default RagService;