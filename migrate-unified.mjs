import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function migrateToUnifiedSchema() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chatwoot_production");
        console.log("Connected to MongoDB");

        const db = mongoose.connection.db;

        // Check if old collections exist
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        
        console.log("Available collections:", collectionNames);

        // Check if DocEmbedding collection exists
        if (collectionNames.includes('docembeddings')) {
            const oldData = await db.collection('docembeddings').find({}).toArray();
            console.log(`Found ${oldData.length} documents in docembeddings collection`);

            if (oldData.length > 0) {
                // Copy data to new unified collection
                await db.collection('unifieddocuments').insertMany(oldData);
                console.log(`✅ Migrated ${oldData.length} documents to unifieddocuments collection`);
            }
        }

        // Check if Client collection exists and has embeddings
        if (collectionNames.includes('clients')) {
            const clientData = await db.collection('clients').find({ embeddings: { $exists: true, $not: { $size: 0 } } }).toArray();
            console.log(`Found ${clientData.length} clients with embeddings`);

            for (const client of clientData) {
                if (client.embeddings && client.embeddings.length > 0) {
                    const unifiedDocs = client.embeddings.map((emb, index) => ({
                        account_id: parseInt(client.account_id) || 0,
                        document_id: client._id.toString(),
                        chunk_index: index,
                        content: emb.pageContent || client.content || client.pageContent || '',
                        embedding: emb.embedding || [],
                        source_title: client.title || 'Migrated Document',
                        title: client.title,
                        description: client.description,
                        source_type: 'file', // Default for migrated data
                        source_uri: client.title || 'legacy-document',
                        processing_method: 'migration',
                        processing_date: client.createdAt || new Date(),
                        embedding_model: 'text-embedding-3-small',
                        chunk_method: 'legacy',
                        inbox_ids: client.inbox_ids || [],
                        bot_api_key: client.bot_api_key,
                        api_key: client.api_key,
                        system_prompt: client.system_prompt,
                        cost_usage: client.cost_usage || 0,
                        metadata: {
                            description: client.description,
                            page_number: emb.metadata?.page_number,
                            extraction_method: 'legacy_migration',
                            content_length: (emb.pageContent || '').length
                        },
                        is_active: client.is_active !== false,
                        is_processed: true,
                        processing_status: 'completed',
                        pageContent: emb.pageContent,
                        document_id_legacy: client._id,
                        createdAt: client.createdAt || new Date(),
                        updatedAt: client.updatedAt || new Date()
                    }));

                    await db.collection('unifieddocuments').insertMany(unifiedDocs);
                    console.log(`✅ Migrated ${unifiedDocs.length} embeddings from client ${client._id}`);
                }
            }
        }

        // Verify the migration
        const finalCount = await db.collection('unifieddocuments').countDocuments();
        console.log(`🎉 Migration complete! Total documents in unified collection: ${finalCount}`);

        // Test a sample query
        const sampleDocs = await db.collection('unifieddocuments').find({}).limit(2).toArray();
        console.log("Sample migrated documents:");
        sampleDocs.forEach((doc, i) => {
            console.log(`${i + 1}. Account: ${doc.account_id}, Title: ${doc.source_title || doc.title}, Content length: ${doc.content?.length || 0}`);
        });

    } catch (error) {
        console.error("❌ Migration failed:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    }
}

migrateToUnifiedSchema();
