import { uploadFilesToAzure, deleteFileFromAzure } from '../utils/azureFileUpload.js';
import { Client, DocEmbedding } from "../model/clientModel.js";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import logger from "../utils/logger.js";
import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import XLSX from "xlsx";

class AzureRagService {
    constructor() {
        this.vectorStore = null;
        this.VECTOR_PATH = "./vectorstore";
        
        // Initialize text splitter with optimal settings
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
            separators: ["\n\n", "\n", ". ", " ", ""],
        });

        // Initialize embeddings
        this.embeddings = new OpenAIEmbeddings({
            apiKey: process.env.OPENAI_API_KEY,
            modelName: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small"
        });
    }

    /**
     * Single API to process files, upload to Azure, and store embeddings
     */
    async uploadWithAzure({ files, body }) {
        try {
            const { account_id } = body;
            
            if (!account_id) {
                throw new Error("account_id is required");
            }

            if (!files || files.length === 0) {
                throw new Error("At least one file is required");
            }

            const results = [];
            const errors = [];

            logger.info(`Processing ${files.length} files with Azure integration`);

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileMetadata = this._extractFileMetadata(body, i);

                try {
                    logger.info(`Processing file ${i + 1}/${files.length}: ${file.originalname}`);

                    // Step 1: Upload file to Azure Blob Storage
                    const azureUploadResults = await uploadFilesToAzure([file]);
                    const azureFileInfo = azureUploadResults[0];

                    logger.info(`File uploaded to Azure: ${azureFileInfo.url}`);

                    // Step 2: Extract text content from file
                    const textContent = await this.extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);

                    // Step 3: Save document to database with Azure reference
                    const doc = await this._saveDocumentToDatabase({
                        account_id,
                        inbox_ids: body.inbox_ids,
                        title: fileMetadata.title || file.originalname,
                        description: fileMetadata.description || `Processed file: ${file.originalname}`,
                        content: textContent,
                        system_prompt: body.system_prompt || "",
                        bot_api_key: body.bot_api_key || "",
                        api_key: body.api_key || "",
                        azureFileInfo,
                        originalFileName: file.originalname,
                        fileSize: file.size,
                        mimeType: file.mimetype
                    });

                    // Step 4: Generate embeddings with proper chunking
                    const chunksCount = await this.processTextForEmbeddings({
                        text: textContent,
                        account_id,
                        document: doc,
                        azureFileInfo
                    });

                    results.push({
                        id: doc._id,
                        title: fileMetadata.title || file.originalname,
                        originalFileName: file.originalname,
                        azureUrl: azureFileInfo.url,
                        azureBlobName: azureFileInfo.blobName,
                        chunks: chunksCount,
                        contentLength: textContent.length,
                        fileIndex: i,
                        operation: 'created'
                    });

                    logger.info(`Successfully processed file: ${file.originalname} (${chunksCount} chunks)`);

                } catch (fileError) {
                    logger.error(`Failed to process file ${file.originalname}:`, fileError);
                    
                    // Cleanup: try to delete uploaded Azure file if processing failed
                    try {
                        if (azureFileInfo && azureFileInfo.blobName) {
                            await deleteFileFromAzure(azureFileInfo.blobName);
                            logger.info(`Cleaned up Azure file: ${azureFileInfo.blobName}`);
                        }
                    } catch (cleanupError) {
                        logger.error(`Failed to cleanup Azure file:`, cleanupError);
                    }

                    errors.push({
                        fileIndex: i,
                        fileName: file.originalname,
                        error: fileError.message
                    });
                }
            }

            return {
                success: true,
                operation: 'azure_rag_processing',
                totalFiles: files.length,
                successCount: results.length,
                errorCount: errors.length,
                results,
                errors,
                message: `Azure RAG processing completed: ${results.length} files processed, ${errors.length} failures`
            };

        } catch (error) {
            logger.error(`Error in Azure RAG processing:`, error);
            throw error;
        }
    }

    /**
     * Extract text content from file buffer based on MIME type
     */
    async extractTextFromBuffer(buffer, mimetype, filename) {
        try {
            logger.info(`Extracting text from ${filename} (${mimetype})`);

            if (mimetype === 'application/pdf') {
                const pdfData = await pdf(buffer);
                return pdfData.text;
            } else if (mimetype === 'text/plain') {
                return buffer.toString('utf-8');
            } else if (this._isExcelFile(mimetype)) {
                return this._processExcelBuffer(buffer);
            } else {
                throw new Error(`Unsupported file type: ${mimetype}`);
            }
        } catch (error) {
            logger.error(`Error extracting text from ${filename}:`, error);
            throw error;
        }
    }

    /**
     * Process Excel buffer and extract text content
     */
    _processExcelBuffer(buffer) {
        try {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            let content = '';

            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                content += `\n=== SHEET: ${sheetName} ===\n`;
                sheetData.forEach((row, index) => {
                    if (row.length > 0) {
                        content += `Row ${index + 1}: ${row.join(' | ')}\n`;
                    }
                });
            });

            return content;
        } catch (error) {
            throw new Error(`Failed to process Excel file: ${error.message}`);
        }
    }

    /**
     * Check if file is Excel format
     */
    _isExcelFile(mimetype) {
        const excelMimeTypes = [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel.sheet.macroEnabled.12',
            'application/vnd.ms-excel.template.macroEnabled.12'
        ];
        return excelMimeTypes.includes(mimetype);
    }

    /**
     * Process text for embeddings using proper chunking
     */
    async processTextForEmbeddings({ text, account_id, document, azureFileInfo }) {
        try {
            logger.info(`Generating embeddings for document: ${document.title}`);

            // Split text into chunks using RecursiveCharacterTextSplitter
            const chunks = await this.textSplitter.splitText(text);
            logger.info(`Text split into ${chunks.length} chunks`);

            const embeddingPromises = chunks.map(async (chunk, index) => {
                try {
                    // Generate embedding for this chunk
                    const embedding = await this.embeddings.embedQuery(chunk);

                    // Create DocEmbedding document
                    const docEmbedding = new DocEmbedding({
                        account_id: parseInt(account_id),
                        content: chunk,
                        embedding: embedding,
                        source_title: document.title,
                        azure_blob_name: azureFileInfo.blobName,
                        chunk_index: index,
                        metadata: {
                            file_type: document.mime_type,
                            upload_source: 'azure',
                            processing_date: new Date().toISOString(),
                            account_id: account_id.toString(),
                            document_id: document._id.toString(),
                            chunk_size: chunk.length,
                            total_chunks: chunks.length,
                            azure_url: azureFileInfo.url,
                            original_filename: document.original_file_name
                        },
                        // Legacy fields for backward compatibility
                        document_id: document._id,
                        pageContent: chunk
                    });

                    await docEmbedding.save();
                    
                    logger.info(`Saved embedding for chunk ${index + 1}/${chunks.length}`);
                    return docEmbedding;

                } catch (embeddingError) {
                    logger.error(`Failed to generate embedding for chunk ${index}:`, embeddingError);
                    throw embeddingError;
                }
            });

            // Wait for all embeddings to be generated and saved
            const savedEmbeddings = await Promise.all(embeddingPromises);

            // Also save embeddings in the main document for backward compatibility
            const legacyEmbeddings = savedEmbeddings.map((docEmb, index) => ({
                pageContent: docEmb.content,
                metadata: {
                    account_id: account_id.toString(),
                    inbox_ids: document.inbox_ids,
                    title: document.title,
                    description: document.description,
                    page_number: (index + 1).toString(),
                    document_id: document._id.toString(),
                    azure_blob_name: azureFileInfo.blobName,
                    chunk_index: index
                },
                embedding: docEmb.embedding
            }));

            // Update the main document with embeddings
            document.embeddings = legacyEmbeddings;
            await document.save();

            logger.info(`Successfully generated and stored ${savedEmbeddings.length} embeddings`);
            return savedEmbeddings.length;

        } catch (error) {
            logger.error(`Error generating embeddings:`, error);
            throw error;
        }
    }

    /**
     * Save document to database with Azure references
     */
    async _saveDocumentToDatabase({ 
        account_id, 
        inbox_ids, 
        title, 
        description, 
        content, 
        system_prompt, 
        bot_api_key, 
        api_key,
        azureFileInfo,
        originalFileName,
        fileSize,
        mimeType
    }) {
        const doc = new Client({
            account_id,
            inbox_ids: inbox_ids ? inbox_ids.split(",") : [],
            title,
            description,
            content,
            system_prompt,
            bot_api_key,
            api_key,
            is_active: true,
            // Azure-specific fields
            azure_url: azureFileInfo.url,
            azure_blob_name: azureFileInfo.blobName,
            original_file_name: originalFileName,
            file_size: fileSize,
            mime_type: mimeType,
            source_type: 'file',
            storage_type: 'azure',
            metadata: {
                sourceType: 'file',
                uploadSource: 'azure',
                processingDate: new Date().toISOString(),
                originalFileName: originalFileName,
                azureBlobName: azureFileInfo.blobName,
                azureUrl: azureFileInfo.url
            }
        });
        
        await doc.save();
        logger.info(`Document saved with Azure reference - ID: ${doc._id}, Blob: ${azureFileInfo.blobName}`);
        return doc;
    }

    /**
     * Search documents with embeddings
     */
    async searchDocuments({ account_id, query, limit = 10 }) {
        try {
            if (!account_id) {
                throw new Error("account_id is required");
            }
            
            if (!query) {
                throw new Error("query is required");
            }

            // Generate query embedding
            const queryEmbedding = await this.embeddings.embedQuery(query);

            // Search in DocEmbedding collection for better performance
            const embeddings = await DocEmbedding.find({ 
                account_id: parseInt(account_id),
                embedding: { $exists: true, $ne: [] }
            }).limit(limit * 5); // Get more to filter

            let allResults = [];

            // Calculate similarity for each embedding
            for (const embedding of embeddings) {
                if (!embedding.embedding || embedding.embedding.length === 0) continue;

                // Calculate cosine similarity
                const similarity = this.cosineSimilarity(queryEmbedding, embedding.embedding);
                
                allResults.push({
                    embeddingId: embedding._id,
                    documentId: embedding.document_id,
                    title: embedding.source_title,
                    content: embedding.content,
                    metadata: embedding.metadata,
                    similarity: similarity,
                    source: embedding.source_title || "Unknown Document",
                    azureBlobName: embedding.azure_blob_name,
                    chunkIndex: embedding.chunk_index
                });
            }

            // Sort by similarity and return top results
            allResults.sort((a, b) => b.similarity - a.similarity);
            return allResults.slice(0, limit);

        } catch (error) {
            logger.error(`Error searching documents for account ${account_id}:`, error);
            throw error;
        }
    }

    /**
     * List documents with Azure information
     */
    async listAccountFiles(account_id) {
        try {
            if (!account_id) {
                throw new Error("account_id is required");
            }

            const documents = await Client.find({ 
                account_id, 
                is_active: true,
                storage_type: 'azure'
            }, { 
                title: 1, 
                description: 1, 
                createdAt: 1, 
                azure_url: 1,
                azure_blob_name: 1,
                original_file_name: 1,
                file_size: 1,
                mime_type: 1,
                'embeddings.0': 1 // Just get count of embeddings
            });

            return documents.map(doc => ({
                id: doc._id,
                title: doc.title,
                description: doc.description,
                azureUrl: doc.azure_url,
                azureBlobName: doc.azure_blob_name,
                originalFileName: doc.original_file_name,
                fileSize: doc.file_size,
                mimeType: doc.mime_type,
                chunksCount: doc.embeddings ? doc.embeddings.length : 0,
                createdAt: doc.createdAt
            }));

        } catch (error) {
            logger.error(`Error listing files for account ${account_id}:`, error);
            throw error;
        }
    }

    /**
     * Delete document and cleanup Azure file
     */
    async deleteAzureFile({ account_id, blobName }) {
        try {
            // Find the document
            const document = await Client.findOne({ 
                account_id: parseInt(account_id), 
                azure_blob_name: blobName,
                is_active: true 
            });

            if (!document) {
                throw new Error("Document not found");
            }

            // Delete embeddings from DocEmbedding collection
            const embeddingDeleteResult = await DocEmbedding.deleteMany({ 
                account_id: parseInt(account_id),
                azure_blob_name: blobName 
            });

            // Mark document as inactive
            document.is_active = false;
            await document.save();

            // Delete file from Azure
            await deleteFileFromAzure(blobName);

            logger.info(`Deleted document and Azure file: ${blobName}, embeddings: ${embeddingDeleteResult.deletedCount}`);

            return {
                success: true,
                documentId: document._id,
                blobName: blobName,
                embeddingsDeleted: embeddingDeleteResult.deletedCount
            };

        } catch (error) {
            logger.error(`Error deleting document with blob ${blobName}:`, error);
            throw error;
        }
    }

    /**
     * Extract file metadata from request body
     */
    _extractFileMetadata(body, fileIndex) {
        let titles = [];
        let descriptions = [];

        if (body.titles) {
            try {
                titles = Array.isArray(body.titles) ? body.titles : JSON.parse(body.titles);
            } catch (e) {
                titles = body.titles.split(',').map(t => t.trim());
            }
        }

        if (body.descriptions) {
            try {
                descriptions = Array.isArray(body.descriptions) ? body.descriptions : JSON.parse(body.descriptions);
            } catch (e) {
                descriptions = body.descriptions.split(',').map(d => d.trim());
            }
        }

        return {
            title: titles[fileIndex] || body.title || null,
            description: descriptions[fileIndex] || body.description || ""
        };
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    cosineSimilarity(vecA, vecB) {
        if (vecA.length !== vecB.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        if (normA === 0 || normB === 0) return 0;

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

export default AzureRagService;
