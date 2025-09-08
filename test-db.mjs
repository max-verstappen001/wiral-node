import { DocEmbedding } from "./model/clientModel.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function testDatabaseInsert() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chatwoot_production");
        console.log("Connected to MongoDB");

        // Create sample data
        const sampleDoc = {
            account_id: 123,
            document_id: "test-doc-1",
            chunk_index: 0,
            content: "This is a test document for the enhanced RAG system. It contains sample text for testing the multi-method retrieval functionality.",
            embedding: Array.from({length: 1536}, () => Math.random()), // Mock embedding
            source_title: "Test Document",
            source_type: "file",
            source_uri: "test-document.txt",
            file_name: "test-document.txt",
            file_type: ".txt",
            processing_method: "api",
            processing_date: new Date(),
            embedding_model: "text-embedding-3-small",
            chunk_method: "recursive_character",
            chunk_size: 1000,
            chunk_overlap: 200,
            inbox_ids: ["inbox1", "inbox2"],
            metadata: {
                description: "Sample test document",
                content_length: 115,
                processing_time_ms: 100,
                extraction_method: "direct_text",
                total_chunks: 1,
                chunk_position: 1
            },
            is_active: true,
            is_processed: true,
            processing_status: "completed"
        };

        // Insert the document
        const result = await DocEmbedding.create(sampleDoc);
        console.log("✅ Successfully inserted test document:", result._id);

        // Test search
        const searchResults = await DocEmbedding.find({
            account_id: 123,
            is_active: true,
            content: { $regex: "test document", $options: "i" }
        });
        console.log("🔍 Search results:", searchResults.length, "documents found");

        // Test aggregation
        const stats = await DocEmbedding.aggregate([
            { $match: { account_id: 123, is_active: true } },
            {
                $group: {
                    _id: null,
                    totalDocuments: { $sum: 1 },
                    sourceTypes: { $addToSet: "$source_type" },
                    fileTypes: { $addToSet: "$file_type" },
                    avgChunkSize: { $avg: "$metadata.content_length" }
                }
            }
        ]);
        console.log("📊 Statistics:", stats[0]);

        console.log("✅ Database test completed successfully!");

    } catch (error) {
        console.error("❌ Database test failed:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    }
}

testDatabaseInsert();
