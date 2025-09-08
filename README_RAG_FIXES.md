# Wiral Node - RAG Service Documentation

## Overview
This project provides a RAG (Retrieval-Augmented Generation) service integrated with Chatwoot for AI-powered customer support. The service allows uploading documents, creating embeddings, and providing context-aware responses using OpenAI's language models.

## Recent Fixes Applied

### 1. Database Schema Updates
- **Client Model**: Added `embeddings` array field and `is_active` boolean field
- **Improved Error Handling**: Better validation and error messages throughout the RAG service

### 2. Enhanced RAG Service
- **Better File Processing**: Improved PDF and text file handling with validation
- **Robust Error Handling**: Comprehensive error handling with proper cleanup
- **New Methods Added**:
  - `listDocuments()` - List all documents for an account
  - `searchDocuments()` - Search through documents using vector similarity
  - `cosineSimilarity()` - Helper function for similarity calculations
- **Improved Logging**: Better logging throughout the service using Winston logger
- **Cost Tracking**: Enhanced cost logging for embeddings with Langfuse integration

### 3. API Endpoints
Created comprehensive REST API endpoints for RAG operations:
- `POST /api/rag/upload` - Upload and index documents
- `GET /api/rag/documents/:account_id` - List documents for an account
- `POST /api/rag/search` - Search documents with semantic similarity
- `DELETE /api/rag/data/:account_id` - Delete all data for an account
- `GET /api/rag/health` - Health check for RAG service

### 4. Enhanced Main Server
- **New Server File**: Created `server.js` with integrated RAG functionality
- **Improved RAG Integration**: Better integration with Chatwoot webhook processing
- **Enhanced Vector Search**: Updated KB retrieval to use the RAG service
- **Better Documentation**: Added comprehensive logging of available endpoints

### 5. File Upload Support
- **Multer Integration**: Configured file upload handling with size limits (10MB)
- **File Type Validation**: Only PDF and TXT files are supported
- **Temporary File Cleanup**: Proper cleanup of uploaded files after processing

## Environment Variables Required

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017/wiral

# OpenAI
OPENAI_API_KEY=your_openai_api_key
OPENAI_EMBED_MODEL=text-embedding-3-small

# Chatwoot
CHATWOOT_URL=your_chatwoot_url
CHATWOOT_BOT_TOKEN=your_chatwoot_bot_token

# Langfuse (optional)
LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
LANGFUSE_SECRET_KEY=your_langfuse_secret_key
LANGFUSE_HOST=your_langfuse_host
```

## Usage

### Starting the Server

```bash
# Install dependencies
npm install

# Start the enhanced server with RAG support
npm start

# For development with auto-restart
npm run dev

# Start the old server (without RAG integration)
npm run start:old
```

### API Usage Examples

#### 1. Upload a Document
```bash
curl -X POST http://localhost:3009/api/rag/upload \
  -F "file=@document.pdf" \
  -F "account_id=123" \
  -F "title=Product Manual" \
  -F "description=User manual for Product X"
```

#### 2. List Documents
```bash
curl http://localhost:3009/api/rag/documents/123
```

#### 3. Search Documents
```bash
curl -X POST http://localhost:3009/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "123",
    "query": "How to reset password?",
    "limit": 5
  }'
```

#### 4. Delete Account Data
```bash
curl -X DELETE http://localhost:3009/api/rag/data/123
```

### Chatwoot Integration

The service automatically processes Chatwoot webhooks and provides context-aware responses using uploaded documents. When a customer message is received:

1. The service retrieves relevant document chunks using vector similarity
2. Combines the chunks with recent conversation history
3. Generates a response using OpenAI's language model
4. Sends the response back to Chatwoot

## File Structure

```
wiral-node/
├── config/
│   └── mongoConnect.js      # MongoDB connection
├── model/
│   └── clientModel.js       # Updated database schemas
├── routes/
│   └── ragRoutes.js         # New RAG API endpoints
├── service/
│   └── ragService.js        # Enhanced RAG service
├── utils/
│   ├── logger.js           # Winston logger
│   ├── langfuse.js         # Langfuse integration
│   └── vectorDB.js         # Vector database utilities
├── uploads/                 # Temporary file uploads directory
├── server.js               # New enhanced server
├── index.js                # Original server
├── index1.js              # RAG-enabled server (older version)
└── package.json           # Updated with new scripts
```

## Key Improvements

1. **Error Resilience**: Better error handling and recovery
2. **Performance**: Optimized vector search and embedding storage
3. **Scalability**: Multi-tenant support with account-based data isolation
4. **Monitoring**: Enhanced logging and cost tracking
5. **API Design**: RESTful endpoints for easy integration
6. **Documentation**: Comprehensive documentation and examples

## Health Checks

- Main service: `GET /health`
- RAG service: `GET /api/rag/health`

Both endpoints provide detailed status information about the running services.

## Troubleshooting

### Common Issues

1. **File Upload Errors**
   - Ensure file size is under 10MB
   - Only PDF and TXT files are supported
   - Check file permissions in uploads directory

2. **Vector Search Issues**
   - Verify OpenAI API key is valid
   - Check embedding model configuration
   - Ensure documents have been properly indexed

3. **Database Connection**
   - Verify MongoDB URI is correct
   - Check MongoDB server is running
   - Ensure database permissions are correct

### Logs

Check the application logs in `bot.log` for detailed error information and operational status.
