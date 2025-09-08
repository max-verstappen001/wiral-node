import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import fs from "fs";
import path from "path";

import { Client, DocEmbedding } from "../model/clientModel.js";
import { OpenAIEmbeddings } from "@langchain/openai";
import logger from "../utils/logger.js";

class RagService {
    constructor() {
        this.vectorStore = null;
        this.VECTOR_PATH = "./vectorstore";
    }

    async upload({ file, body }) {
        try {
            const { account_id, inbox_ids, title, description, system_prompt, bot_api_key, api_key } = body;
            
            if (!account_id) {
                throw new Error("account_id is required");
            }
            
            if (!file || !file.path) {
                throw new Error("File is required");
            }

            // Debug logging
            logger.info("RagService upload - File object:");
            logger.info(`- Original name: ${file.originalname}`);
            logger.info(`- Mimetype: ${file.mimetype}`);
            logger.info(`- File path: ${file.path}`);
            logger.info(`- File size: ${file.size}`);
            logger.info(`- File exists: ${fs.existsSync(file.path)}`);

            // Validate file exists and is readable
            if (!fs.existsSync(file.path)) {
                throw new Error(`Uploaded file not found at path: ${file.path}`);
            }

            const fileStats = fs.statSync(file.path);
            if (fileStats.size === 0) {
                throw new Error("Uploaded file is empty");
            }

            logger.info(`File validation passed - size: ${fileStats.size} bytes`);

            // Initialize embeddings
            const embeddings = new OpenAIEmbeddings({
                openAIApiKey: process.env.OPENAI_API_KEY,
            });

            let pages = [];

            // Process file based on type
            if (file.mimetype === "application/pdf") {
                try {
                    // Read file buffer first with explicit path resolution
                    const absoluteFilePath = file.path.startsWith('/') ? file.path : `./${file.path}`;
                    logger.info(`Attempting to read PDF file: ${absoluteFilePath}`);
                    logger.info(`Current working directory: ${process.cwd()}`);
                    logger.info(`Full resolved path: ${path.resolve(absoluteFilePath)}`);
                    
                    const fileBuffer = fs.readFileSync(absoluteFilePath);
                    logger.info(`PDF file read successfully, buffer size: ${fileBuffer.length}`);
                    
                    let pdfData = null;
                    
                    // Try pdf-parse first
                    try {
                        const { default: pdf } = await import("pdf-parse");
                        pdfData = await pdf(fileBuffer, {
                            max: 0, // Parse all pages
                            version: 'v1.10.100'
                        });
                        logger.info(`PDF parsed successfully with pdf-parse, text length: ${pdfData.text.length}`);
                    } catch (pdfParseError) {
                        logger.warn(`pdf-parse failed: ${pdfParseError.message}`);
                        
                        // Fallback to pdf2text
                        try {
                            const pdf2text = await import("pdf2text");
                            const text = await pdf2text.pdf2text(absoluteFilePath);
                            pdfData = { text: text };
                            logger.info(`PDF parsed successfully with pdf2text fallback, text length: ${text.length}`);
                        } catch (pdf2textError) {
                            logger.error(`pdf2text fallback also failed: ${pdf2textError.message}`);
                            
                            // Final fallback - try to extract basic text or provide meaningful guidance
                            throw new Error(`Unable to parse PDF with available libraries. Please try: 1) Converting your PDF to text format first, 2) Using a different PDF file, 3) Ensuring the PDF is not password protected or corrupted.`);
                        }
                    }
                    
                    pages = pdfData.text.split(/\f/).filter(page => page.trim().length > 0);
                    if (pages.length === 0) {
                        pages = [pdfData.text];
                    }
                    logger.info(`PDF split into ${pages.length} pages`);
                } catch (pdfError) {
                    logger.error(`PDF processing error for file ${file.path}:`, pdfError);
                    logger.error(`PDF error stack:`, pdfError.stack);
                    throw new Error(pdfError.message);
                }
            } else if (file.mimetype === "text/plain") {
                try {
                    logger.info(`Attempting to read text file: ${file.path}`);
                    const text = fs.readFileSync(file.path, "utf8");
                    logger.info(`Text file read successfully, length: ${text.length}`);
                    pages = [text];
                } catch (textError) {
                    logger.error(`Text file reading error for file ${file.path}:`, textError);
                    throw new Error(`Failed to read text file: ${textError.message}`);
                }
            } else {
                throw new Error("Only PDF and TXT files are supported");
            }

            if (pages.length === 0 || pages.every(page => !page.trim())) {
                throw new Error("File contains no readable content");
            }

            // Save original doc in Mongo with embeddings array initialized
            const doc = new Client({
                account_id,
                inbox_ids: inbox_ids ? inbox_ids.split(",") : [],
                title: title || file.originalname || "Untitled Document",
                description: description || "",
                content: pages.join("\n---PAGE BREAK---\n"),
                system_prompt: system_prompt || "",
                bot_api_key: bot_api_key || "",
                api_key: api_key || "",
                is_active: true
            });
            await doc.save();
            logger.info(`Document saved with ID: ${doc._id}`);

            // Split pages into chunks
            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 1000,
                chunkOverlap: 100,
            });

            let allChunks = [];
            for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
                const pageText = pages[pageIndex];
                if (!pageText.trim()) continue;

                const chunks = await splitter.splitText(pageText);
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    if (chunk.trim()) {
                        const meta = {
                            account_id,
                            inbox_ids: inbox_ids ? inbox_ids.split(",") : [],
                            title: title || file.originalname || "Untitled Document",
                            description: description || "",
                            page_number: `page${pageIndex + 1}-${i + 1}`,
                            document_id: doc._id.toString(),
                        };
                        allChunks.push({ pageContent: chunk, metadata: meta });
                    }
                }
            }

            // Compute embeddings and store everything
            if (allChunks.length > 0) {
                // Allow specifying embedding model via body or env
                const embeddingModel = body.embedding_model || process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
                embeddings.modelName = embeddingModel;
                
                const texts = allChunks.map(c => c.pageContent);
                const vectors = await embeddings.embedDocuments(texts);

                // Prepare chunks with embeddings for batch storage
                const chunksWithEmbeddings = allChunks.map((chunk, i) => ({
                    ...chunk,
                    embedding: vectors[i]
                }));

                // Store all embeddings in Client document
                await Client.updateOne(
                    { _id: doc._id },
                    { $set: { embeddings: chunksWithEmbeddings } }
                );

                // Log embedding cost to Langfuse
                try {
                    const totalTokens = texts.reduce((sum, t) => sum + t.split(/\s+/).length, 0);
                    // OpenAI embedding pricing as of 2024:
                    // text-embedding-ada-002: $0.0001 / 1K tokens
                    // text-embedding-3-small: $0.00002 / 1K tokens
                    // text-embedding-3-large: $0.00013 / 1K tokens
                    let model = embedder.modelName || embedder.model || "text-embedding-3-small";
                    let pricePer1K = 0.00002; // default 3-small
                    if (model.includes("ada-002")) pricePer1K = 0.0001;
                    else if (model.includes("3-large")) pricePer1K = 0.00013;
                    if (process.env.OPENAI_EMBED_COST_PER_1K) pricePer1K = parseFloat(process.env.OPENAI_EMBED_COST_PER_1K);
                    
                    const cost = (totalTokens / 1000) * pricePer1K;
                    
                    // Import Langfuse service dynamically to avoid circular dependencies
                    const sharedLangfuseService = (await import("../utils/langfuse.js")).default;
                    await sharedLangfuseService.logCost(account_id, {
                        transaction_type: "embedding",
                        amount: cost,
                        tokens_used: totalTokens,
                        model,
                        document_id: doc._id.toString(),
                        pricing_tier: process.env.OPENAI_PRICING_TIER || "default"
                    });
                    logger.info(`Embedding cost logged: $${cost.toFixed(6)} for ${totalTokens} tokens`);
                } catch (err) {
                    logger.warn("Langfuse cost logging failed", err.message);
                }

                // Store each embedding in DocEmbedding collection with metadata (for compatibility)
                const docEmbeddingDocs = chunksWithEmbeddings.map(chunk => ({
                    document_id: doc._id,
                    pageContent: chunk.pageContent,
                    metadata: {
                        account_id: chunk.metadata.account_id,
                        page_number: chunk.metadata.page_number,
                    },
                    embedding: chunk.embedding
                }));
                
                if (docEmbeddingDocs.length > 0) {
                    await DocEmbedding.insertMany(docEmbeddingDocs);
                    logger.info(`Stored ${docEmbeddingDocs.length} embedding chunks in DocEmbedding collection`);
                }

                // Add to vector store if needed (for compatibility)
                if (this.vectorStore && this.vectorStore.addDocuments) {
                    await this.vectorStore.addDocuments(allChunks, { vectors });
                    if (this.vectorStore.save) await this.vectorStore.save(this.VECTOR_PATH);
                }
            }

            // Clean up temp file
            try {
                fs.unlinkSync(file.path);
                logger.info(`Cleaned up temp file: ${file.path}`);
            } catch (error) {
                logger.warn(`Failed to delete temp file: ${file.path}`, error.message);
            }

            return {
                message: "File uploaded & indexed successfully",
                id: doc._id,
                chunks: allChunks.length,
                title: doc.title,
                system_prompt: doc.system_prompt,
            };
        } catch (error) {
            logger.error("Error in upload:", error.message);
            // Clean up temp file on error
            if (file && file.path) {
                try {
                    fs.unlinkSync(file.path);
                } catch (cleanupError) {
                    logger.warn(`Failed to cleanup temp file on error: ${file.path}`, cleanupError.message);
                }
            }
            throw error;
        }
    }

    async deleteData({ account_id }) {
        try {
            if (!account_id) {
                throw new Error("account_id is required");
            }

            // Delete from MongoDB
            const clientResult = await Client.deleteMany({ account_id });
            logger.info(`Deleted ${clientResult.deletedCount} documents from Client collection for account ${account_id}`);

            const embeddingResult = await DocEmbedding.deleteMany({ "metadata.account_id": account_id });
            logger.info(`Deleted ${embeddingResult.deletedCount} embeddings from DocEmbedding collection for account ${account_id}`);

            return { 
                message: `All data for account ${account_id} deleted successfully`,
                deleted: {
                    documents: clientResult.deletedCount,
                    embeddings: embeddingResult.deletedCount
                }
            };
        } catch (error) {
            logger.error(`Error deleting data for account ${account_id}:`, error.message);
            throw error;
        }
    }

    async listDocuments({ account_id }) {
        try {
            if (!account_id) {
                throw new Error("account_id is required");
            }

            const documents = await Client.find(
                { account_id, is_active: true },
                { 
                    title: 1, 
                    description: 1, 
                    createdAt: 1, 
                    updatedAt: 1,
                    'embeddings.0': 1 // Just get count of embeddings
                }
            );

            return documents.map(doc => ({
                id: doc._id,
                title: doc.title,
                description: doc.description,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
                chunksCount: doc.embeddings ? doc.embeddings.length : 0
            }));
        } catch (error) {
            logger.error(`Error listing documents for account ${account_id}:`, error.message);
            throw error;
        }
    }

    async searchDocuments({ account_id, query, limit = 10 }) {
        try {
            if (!account_id) {
                throw new Error("account_id is required");
            }
            
            if (!query) {
                throw new Error("query is required");
            }

            // Initialize embeddings
            const embeddings = new OpenAIEmbeddings({
                apiKey: process.env.OPENAI_API_KEY,
                modelName: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small"
            });

            // Generate query embedding
            const queryEmbedding = await embeddings.embedQuery(query);

            // Find documents for this account
            const documents = await Client.find({ 
                account_id, 
                is_active: true,
                embeddings: { $exists: true, $ne: [] }
            });

            let allResults = [];

            // Search through embeddings in each document
            for (const doc of documents) {
                if (!doc.embeddings || doc.embeddings.length === 0) continue;

                for (const embedding of doc.embeddings) {
                    if (!embedding.embedding || embedding.embedding.length === 0) continue;

                    // Calculate cosine similarity
                    const similarity = this.cosineSimilarity(queryEmbedding, embedding.embedding);
                    
                    allResults.push({
                        documentId: doc._id,
                        title: doc.title,
                        content: embedding.pageContent,
                        metadata: embedding.metadata,
                        similarity: similarity,
                        source: doc.title || "Unknown Document"
                    });
                }
            }

            // Sort by similarity and return top results
            allResults.sort((a, b) => b.similarity - a.similarity);
            return allResults.slice(0, limit);

        } catch (error) {
            logger.error(`Error searching documents for account ${account_id}:`, error.message);
            throw error;
        }
    }

    // Helper function to calculate cosine similarity
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

export default RagService;