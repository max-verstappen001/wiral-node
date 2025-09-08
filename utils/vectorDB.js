// vectorStore.js - Local MongoDB implementation
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MongoClient } from "mongodb";
import logger from "./logger.js";

const embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
});

// Local MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "vector_db";
const COLLECTION_NAME = "embeddings";
const INDEX_NAME = "vector_index";

let client;
let vectorStore;

async function initializeMongoClient() {
    if (!client) {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Connected to local MongoDB');

        // Create vector search index if it doesn't exist
        await createVectorIndex();
    }
    return client;
}

async function createVectorIndex() {
    try {
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // Check if index already exists
        const indexes = await collection.listIndexes().toArray();
        const vectorIndexExists = indexes.some(index => index.name === INDEX_NAME);

        if (!vectorIndexExists) {
            // Create vector search index for local MongoDB
            // Note: For local MongoDB, you might need to use regular indexes
            // Vector search indexes are typically for MongoDB Atlas
            await collection.createIndex(
                { "metadata.account_id": 1, "metadata.document_id": 1 },
                { name: "metadata_index" }
            );
            console.log('Created metadata index for local MongoDB');
        }
    } catch (error) {
        console.warn('Could not create vector index:', error.message);
        // Continue without vector index for local setup
    }
}

async function loadVectorStore() {
    try {
        await initializeMongoClient();

        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // For local MongoDB, we'll create a custom vector store implementation
        vectorStore = new LocalMongoVectorStore(collection, embeddings);

        console.log('Local MongoDB vector store loaded successfully');
    } catch (error) {
        console.error('Error loading vector store:', error);
        throw error;
    }
}

// Custom LocalMongoVectorStore class for local MongoDB
class LocalMongoVectorStore {
    constructor(collection, embeddings) {
        this.collection = collection;
        this.embeddings = embeddings;
    }

    async addDocuments(documents, options = {}) {
        const { vectors } = options;

        if (!vectors || vectors.length !== documents.length) {
            throw new Error('Vectors must be provided and match document count');
        }

        const documentsToInsert = documents.map((doc, index) => ({
            pageContent: doc.pageContent,
            metadata: doc.metadata,
            embedding: vectors[index],
            createdAt: new Date()
        }));

        await this.collection.insertMany(documentsToInsert);
    }

    async clear() {
        await this.collection.deleteMany({});
    }

    async save() {
        // No-op for MongoDB as data is already persisted
        return Promise.resolve();
    }

    async similaritySearchWithScore(query, k = 10, filter = {}) {
        // Generate embedding for query
        const queryVector = await this.embeddings.embedQuery(query);

        // For local MongoDB without vector search, we'll use metadata filtering
        // and then compute similarity in memory (not optimal for large datasets)
        const pipeline = [
            { $match: filter },
            { $limit: 1000 } // Limit to prevent memory issues
        ];

        const documents = await this.collection.aggregate(pipeline).toArray();

        // Compute cosine similarity in memory
        const results = documents
            .map(doc => {
                const similarity = this.cosineSimilarity(queryVector, doc.embedding);
                return {
                    document: {
                        pageContent: doc.pageContent,
                        metadata: doc.metadata
                    },
                    score: similarity
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, k);

        return results;
    }

    async similaritySearch(query, k = 10, filter = {}) {
        const results = await this.similaritySearchWithScore(query, k, filter);
        return results.map(result => result.document);
    }

    // Cosine similarity calculation
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

    async deleteDocumentsByFilter(filter) {
        const result = await this.collection.deleteMany(filter);
        return result.deletedCount;
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
    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
        vectorStore = null;
        logger.info("MongoDB connection closed");
    }
}

// RAG Functions for compatibility
async function insertEmbeddings(params) {
    const { account_id, chunks, vectors, sourceTitle, sourceUri, documentId } = params;
    
    try {
        logger.info(`Inserting ${chunks.length} embeddings for account ${account_id}`);
        
        if (!vectorStore) {
            throw new Error("Vector store not initialized");
        }

        // Add documents to vector store
        const documents = chunks.map(chunk => ({
            pageContent: chunk.content,
            metadata: {
                account_id: parseInt(account_id),
                source_title: sourceTitle,
                source_uri: sourceUri,
                document_id: documentId,
                chunk_index: chunk.index || 0
            }
        }));

        // Pass vectors to addDocuments method
        await vectorStore.addDocuments(documents, { vectors });
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
        if (!vectorStore) {
            throw new Error("Vector store not initialized");
        }

        // Search with filter for account_id
        const results = await vectorStore.similaritySearchWithScore(query, limit, {
            account_id: parseInt(account_id)
        });

        return results.map(([doc, score]) => ({
            content: doc.pageContent,
            document_id: doc.metadata.document_id,
            source_title: doc.metadata.source_title,
            source_uri: doc.metadata.source_uri,
            score: score,
            account_id: doc.metadata.account_id,
            chunk_index: doc.metadata.chunk_index
        }));
    } catch (error) {
        logger.error("Error retrieving KB chunks:", error);
        throw error;
    }
}

// Initialize on module load
await loadVectorStore();

export {
    vectorStore,
    loadVectorStore,
    getVectorStore,
    isVectorStoreReady,
    closeConnection,
    insertEmbeddings,
    retrieveKBChunks,
    MONGODB_URI,
    DB_NAME,
    COLLECTION_NAME
};