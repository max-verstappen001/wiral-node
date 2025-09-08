# Frontend Integration Guide

## Quick Start

### 1. API Base URL
```javascript
const API_BASE = 'http://localhost:3009/api/rag';
```

### 2. Basic Usage Examples

#### Upload Document
```javascript
async function uploadDocument(accountId, file, title, description) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('account_id', accountId);
  formData.append('title', title);
  formData.append('description', description);

  const response = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData
  });

  return await response.json();
}
```

#### List Documents
```javascript
async function getDocuments(accountId) {
  const response = await fetch(`${API_BASE}/documents/${accountId}`);
  const data = await response.json();
  return data.documents;
}
```

#### Search Documents
```javascript
async function searchDocuments(accountId, query, limit = 10) {
  const response = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, query, limit })
  });
  
  const data = await response.json();
  return data.results;
}
```

## Testing Tools

### 1. Interactive API Tester
Visit `http://localhost:3009/api-tester.html` after starting the server to test all endpoints with a user-friendly interface.

### 2. Postman Collection
Import `postman_collection.json` into Postman for comprehensive API testing.

### 3. OpenAPI Spec
Use `openapi.yaml` with Swagger UI or other OpenAPI tools for documentation and testing.

## Key Points

- **File Limits**: Max 10MB, PDF/TXT only
- **Account Isolation**: All data is isolated by `account_id`
- **Similarity Scores**: Range from 0.0 to 1.0 (higher = more relevant)
- **Error Handling**: All endpoints return JSON with `error` field on failure
- **No Authentication**: Currently open access for internal use

## File Structure for Frontend
```
/api/rag/upload          - POST (multipart/form-data)
/api/rag/documents/:id   - GET
/api/rag/search          - POST (application/json)
/api/rag/data/:id        - DELETE
/api/rag/health          - GET
/health                  - GET (system health)
```

## Environment Requirements
Ensure these environment variables are set:
- `OPENAI_API_KEY` - For embeddings and search
- `MONGODB_URI` - Database connection
- `CHATWOOT_URL` - For webhook integration
- `CHATWOOT_BOT_TOKEN` - For sending responses

## Error Codes
- `200` - Success
- `400` - Bad Request (missing/invalid parameters)
- `413` - File too large (>10MB)
- `415` - Unsupported file type
- `500` - Server error

Start the server with `npm start` and visit the API tester at `http://localhost:3009/api-tester.html` to begin testing!
