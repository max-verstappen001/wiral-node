// vectorStore.js - Fixed Local MongoDB implementation
import { OpenAIEmbeddings } from "@langchain/openai";
import { MongoClient } from "mongodb";
import logger from "./logger.js";

import dotenv from "dotenv";
dotenv.config();
const embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
});

// Local MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = "wiral";
const COLLECTION_NAME = "embeddings";

let client;
let vectorStore;

async function initializeMongoClient() {
    if (!client) {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Connected to local MongoDB');

        // Create indexes for better performance
        await createIndexes();
    }
    return client;
}

async function createIndexes() {
    try {
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // Create compound index for metadata filtering
        await collection.createIndex(
            {
                "metadata.account_id": 1,
                "metadata.document_id": 1,
                "createdAt": -1
            },
            {
                name: "metadata_compound_index",
                background: true
            }
        );

        console.log('Created compound index for metadata');
    } catch (error) {
        console.warn('Could not create indexes:', error.message);
    }
}

async function loadVectorStore() {
    try {
        await initializeMongoClient();

        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        vectorStore = new LocalMongoVectorStore(collection, embeddings);

        console.log('Local MongoDB vector store loaded successfully');
        return vectorStore;
    } catch (error) {
        console.error('Error loading vector store:', error);
        throw error;
    }
}

// Fixed LocalMongoVectorStore class
class LocalMongoVectorStore {
    constructor(collection, embeddings) {
        this.collection = collection;
        this.embeddings = embeddings;
    }

    async addDocuments(documents, options = {}) {
        try {
            const { vectors } = options;

            // Generate embeddings if not provided
            let embeddingVectors = vectors;
            if (!embeddingVectors) {
                console.log('Generating embeddings for documents...');
                const contents = documents.map(doc => doc.pageContent);
                embeddingVectors = await this.embeddings.embedDocuments(contents);
            }

            if (embeddingVectors.length !== documents.length) {
                throw new Error(`Vector count (${embeddingVectors.length}) must match document count (${documents.length})`);
            }

            const documentsToInsert = documents.map((doc, index) => ({
                pageContent: doc.pageContent,
                metadata: {
                    ...doc.metadata,
                    // Ensure account_id is a number for consistent querying
                    account_id: typeof doc.metadata.account_id === 'string'
                        ? parseInt(doc.metadata.account_id)
                        : doc.metadata.account_id
                },
                embedding: embeddingVectors[index],
                createdAt: new Date()
            }));

            const result = await this.collection.insertMany(documentsToInsert);
            console.log(`Inserted ${result.insertedCount} documents`);

            return result;
        } catch (error) {
            console.error('Error adding documents:', error);
            throw error;
        }
    }

    async clear(filter = {}) {
        const result = await this.collection.deleteMany(filter);
        console.log(`Cleared ${result.deletedCount} documents`);
        return result;
    }

    async similaritySearchWithScore(query, k = 10, filter = {}) {
        try {
            // Generate embedding for query
            console.log('Generating query embedding...');
            const queryVector = await this.embeddings.embedQuery(query);

            // Build MongoDB aggregation pipeline
            const pipeline = [];

            // Add match stage if filter is provided
            if (Object.keys(filter).length > 0) {
                // Convert account_id to number if it's a string
                const normalizedFilter = { ...filter };
                if (normalizedFilter.account_id && typeof normalizedFilter.account_id === 'string') {
                    normalizedFilter.account_id = parseInt(normalizedFilter.account_id);
                }

                // Build metadata filter
                const matchStage = {};
                Object.keys(normalizedFilter).forEach(key => {
                    matchStage[`metadata.${key}`] = normalizedFilter[key];
                });

                pipeline.push({ $match: matchStage });
            }

            // Limit documents to process (for performance)
            pipeline.push({ $limit: Math.max(k * 10, 1000) });

            console.log('Executing MongoDB query with pipeline:', JSON.stringify(pipeline, null, 2));

            const documents = await this.collection.aggregate(pipeline).toArray();
            console.log(`Found ${documents.length} documents to process`);

            if (documents.length === 0) {
                console.log('No documents found matching filter');
                return [];
            }

            // Compute cosine similarity for each document
            const results = documents
                .map(doc => {
                    if (!doc.embedding || !Array.isArray(doc.embedding)) {
                        console.warn('Document missing valid embedding:', doc._id);
                        return null;
                    }

                    const similarity = this.cosineSimilarity(queryVector, doc.embedding);
                    return {
                        document: {
                            pageContent: doc.pageContent,
                            metadata: doc.metadata
                        },
                        score: similarity
                    };
                })
                .filter(result => result !== null) // Remove null results
                .sort((a, b) => b.score - a.score) // Sort by similarity descending
                .slice(0, k); // Take top k results

            console.log(`Returning ${results.length} results with scores:`,
                results.slice(0, 3).map(r => r.score));

            return results;
        } catch (error) {
            console.error('Error in similarity search:', error);
            throw error;
        }
    }

    async similaritySearch(query, k = 10, filter = {}) {
        const results = await this.similaritySearchWithScore(query, k, filter);
        return results.map(result => result.document);
    }

    // Improved cosine similarity calculation with error handling
    cosineSimilarity(vecA, vecB) {
        if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
            console.warn('Invalid vectors for similarity calculation');
            return 0;
        }

        if (vecA.length !== vecB.length) {
            console.warn(`Vector length mismatch: ${vecA.length} vs ${vecB.length}`);
            return 0;
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        if (normA === 0 || normB === 0) {
            console.warn('Zero norm vector detected');
            return 0;
        }

        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        return Math.max(0, Math.min(1, similarity)); // Clamp between 0 and 1
    }

    async deleteDocumentsByFilter(filter) {
        // Convert account_id to number if it's a string
        const normalizedFilter = { ...filter };
        if (normalizedFilter.account_id && typeof normalizedFilter.account_id === 'string') {
            normalizedFilter.account_id = parseInt(normalizedFilter.account_id);
        }

        // Build metadata filter
        const matchStage = {};
        Object.keys(normalizedFilter).forEach(key => {
            matchStage[`metadata.${key}`] = normalizedFilter[key];
        });

        const result = await this.collection.deleteMany(matchStage);
        console.log(`Deleted ${result.deletedCount} documents`);
        return result.deletedCount;
    }

    // Add method to get document count
    async getDocumentCount(filter = {}) {
        const normalizedFilter = { ...filter };
        if (normalizedFilter.account_id && typeof normalizedFilter.account_id === 'string') {
            normalizedFilter.account_id = parseInt(normalizedFilter.account_id);
        }

        const matchStage = {};
        Object.keys(normalizedFilter).forEach(key => {
            matchStage[`metadata.${key}`] = normalizedFilter[key];
        });

        return await this.collection.countDocuments(matchStage);
    }
}

function isVectorStoreReady() {
    return vectorStore !== null && vectorStore !== undefined;
}

async function getVectorStore() {
    if (!isVectorStoreReady()) {
        await loadVectorStore();
    }
    return vectorStore;
}

// Cleanup function
async function closeConnection() {
    if (client) {
        await client.close();
        client = null;
        vectorStore = null;
        logger.info("MongoDB connection closed");
    }
}

// Fixed RAG Functions
async function insertEmbeddings(params) {
    const { account_id, chunks, vectors, sourceTitle, sourceUri, documentId } = params;

    try {
        logger.info(`Inserting ${chunks.length} embeddings for account ${account_id}`);

        const store = await getVectorStore();

        // Create documents with proper structure
        const documents = chunks.map((chunk, index) => ({
            pageContent: chunk.content,
            metadata: {
                account_id: parseInt(account_id),
                source_title: sourceTitle,
                source_uri: sourceUri,
                document_id: documentId,
                chunk_index: chunk.index !== undefined ? chunk.index : index
            }
        }));

        // Add documents (will generate embeddings if vectors not provided)
        await store.addDocuments(documents, { vectors });

        logger.info(`Successfully inserted ${chunks.length} embeddings`);
        return { success: true, inserted: chunks.length };
    } catch (error) {
        logger.error("Error inserting embeddings:", error);
        throw error;
    }
}

async function retrieveKBChunks(params) {
    const { account_id, query, limit = 10 } = params;

    try {
        logger.info(`Retrieving chunks for account ${account_id} with query: "${query.substring(0, 50)}..."`);

        const store = await getVectorStore();

        // Check if we have any documents for this account
        const docCount = await store.getDocumentCount({ account_id: parseInt(account_id) });
        console.log(`Found ${docCount} documents for account ${account_id}`);

        if (docCount === 0) {
            logger.warn(`No documents found for account ${account_id}`);
            return [];
        }

        // Search with filter for account_id
        const results = await store.similaritySearchWithScore(query, limit, {
            account_id: parseInt(account_id)
        });

        logger.info(`Retrieved ${results.length} chunks for account ${account_id}`);

        // Return in expected format
        return results.map(result => ({
            content: result.document.pageContent,
            document_id: result.document.metadata.document_id,
            source_title: result.document.metadata.source_title,
            source_uri: result.document.metadata.source_uri,
            score: result.score,
            account_id: result.document.metadata.account_id,
            chunk_index: result.document.metadata.chunk_index || 0
        }));
    } catch (error) {
        logger.error("Error retrieving KB chunks:", error);
        throw error;
    }
}

// Test function to verify setup
async function testVectorStore() {
    try {
        const store = await getVectorStore();

        // Insert test document
        await store.addDocuments([{
            pageContent: "This is a test document about artificial intelligence and machine learning.",
            metadata: {
                account_id: 1,
                document_id: "test-doc-1",
                source_title: "Test Document",
                source_uri: "test://doc"
            }
        }]);

        // Search for it
        const results = await store.similaritySearchWithScore("artificial intelligence", 5, {
            account_id: 1
        });

        console.log('Test results:', results);
        return results.length > 0;
    } catch (error) {
        console.error('Test failed:', error);
        return false;
    }
}

// Initialize on module load
loadVectorStore().catch(error => {
    console.error('Failed to initialize vector store:', error);
});

export {
    vectorStore,
    loadVectorStore,
    getVectorStore,
    isVectorStoreReady,
    closeConnection,
    insertEmbeddings,
    retrieveKBChunks,
    testVectorStore,
    MONGODB_URI,
    DB_NAME,
    COLLECTION_NAME
};