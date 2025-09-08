import mongoose from "mongoose";

// Unified schema for all content types (files, URLs, mixed content)
// Combines both Client and DocEmbedding schemas into one comprehensive model
const unifiedDocumentSchema = new mongoose.Schema({
    // Core identification
    account_id: { type: Number, required: true, index: true },
    document_id: { type: String, required: true, index: true }, // Unique document identifier
    chunk_index: { type: Number, default: 0, index: true },
    
    // Content and embedding
    content: { type: String, required: true },
    pageContent: { type: String }, // Legacy alias for content
    embedding: { type: [Number], required: true },
    
    // Legacy embeddings array support (from old Client schema)
    embeddings: [{
        pageContent: String,
        metadata: {
            account_id: String,
            inbox_ids: [String],
            title: String,
            description: String,
            page_number: String,
            document_id: String,
        },
        embedding: [Number]
    }],
    
    // Source information
    source_title: { type: String, required: true },
    title: { type: String }, // Legacy alias for source_title
    description: { type: String },
    source_type: { type: String, enum: ['file', 'url', 'file_url', 'mixed'], required: true, index: true },
    source_url: { type: String }, // Original URL for url/file_url types
    source_uri: { type: String }, // Generic source identifier
    
    // File-specific information
    file_name: { type: String },
    file_type: { type: String }, // .pdf, .docx, etc.
    file_size: { type: Number },
    file_id: { type: String, index: true }, // Unique file identifier
    
    // Azure storage information
    azure_url: { type: String },
    azure_blob_name: { type: String, index: true },
    azure_container: { type: String, default: 'uploads' },
    
    // URL-specific information
    url_id: { type: String, index: true }, // Unique URL identifier
    crawl_date: { type: Date },
    
    // Processing information
    processing_method: { type: String, enum: ['manual', 'api', 'bulk'], default: 'api' },
    processing_date: { type: Date, default: Date.now },
    embedding_model: { type: String, default: 'text-embedding-3-small' },
    chunk_method: { type: String, default: 'recursive_character' },
    chunk_size: { type: Number, default: 1000 },
    chunk_overlap: { type: Number, default: 200 },
    
    // Bot configuration and client settings
    inbox_ids: [{ type: String }],
    bot_api_key: { type: String },
    api_key: { type: String },
    system_prompt: { type: String },
    cost_usage: { type: Number, default: 0 }, // From old Client schema
    
    // Content metadata
    metadata: {
        description: String,
        page_number: String,
        total_pages: Number,
        language: String,
        content_length: Number,
        processing_time_ms: Number,
        extraction_method: String,
        quality_score: Number,
        keywords: [String],
        // Allow additional flexible metadata
        additional: mongoose.Schema.Types.Mixed
    },
    
    // Status and flags
    is_active: { type: Boolean, default: true },
    is_processed: { type: Boolean, default: true },
    processing_status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'completed' },
    error_message: { type: String },
    
    // Legacy fields for backward compatibility
    pageContent: String, // Alias for content
    document_id_legacy: { type: mongoose.Schema.Types.ObjectId, ref: 'UnifiedDocument' }
}, { 
    timestamps: true,
    // Add indexes for better query performance
    index: [
        { account_id: 1, source_type: 1 },
        { account_id: 1, is_active: 1 },
        { account_id: 1, processing_date: -1 },
        { document_id: 1, chunk_index: 1 },
        { file_id: 1 },
        { url_id: 1 },
        { azure_blob_name: 1 }
    ]
});

// Add text index for full-text search
unifiedDocumentSchema.index({ 
    content: 'text', 
    source_title: 'text',
    title: 'text',
    description: 'text',
    'metadata.description': 'text'
});

// Create the unified model
const UnifiedDocument = mongoose.model("UnifiedDocument", unifiedDocumentSchema);

// Legacy aliases for backward compatibility
const Client = UnifiedDocument;
const DocEmbedding = UnifiedDocument;

export { UnifiedDocument, Client, DocEmbedding };