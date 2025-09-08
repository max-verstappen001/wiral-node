#!/bin/bash

# Test Multi-File RAG API Endpoints

echo "🚀 Testing Multi-File RAG System"
echo "================================"

# Test 1: Health Check
echo "1. Health Check..."
curl -s "http://localhost:3009/api/multi-rag/health" | jq '.'

echo -e "\n2. Testing File Upload..."
# Test 2: File Upload
curl -X POST "http://localhost:3009/api/multi-rag/upload-single" \
  -F "file=@test-sample.txt" \
  -F "account_id=123" \
  -F "title=Test Document" \
  -F "description=Sample test for RAG system" | jq '.'

echo -e "\n3. Testing Enhanced Search..."
# Test 3: Enhanced Search
curl -X POST "http://localhost:3009/api/multi-rag/search" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": 123,
    "query": "RAG system features",
    "limit": 5,
    "search_method": "hybrid",
    "filters": {
      "source_type": "file"
    }
  }' | jq '.'

echo -e "\n4. Testing Document Statistics..."
# Test 4: Document Statistics
curl -s "http://localhost:3009/api/multi-rag/stats/123" | jq '.'

echo -e "\n5. Testing Document Retrieval..."
# Test 5: Get Documents
curl -s "http://localhost:3009/api/multi-rag/documents/123?limit=5" | jq '.'

echo -e "\n✅ Test completed!"
