#!/bin/bash

# Test Multi-File RAG System with Mock Data

echo "🚀 Testing Multi-File RAG System with Direct Database Insert"
echo "============================================================"

# Test 1: Health Check
echo "1. Health Check..."
curl -s "http://localhost:3009/api/multi-rag/health" | jq '.'

echo -e "\n2. Testing URL Processing (Firecrawl)..."
# Test URL processing instead of file upload to avoid Azure issues
curl -X POST "http://localhost:3009/api/multi-rag/process-urls" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": 123,
    "urls": ["https://httpbin.org/json"],
    "title": "Test API Response",
    "description": "Testing URL processing with httpbin"
  }' | jq '.'

echo -e "\n3. Testing Enhanced Search..."
# Test Enhanced Search
curl -X POST "http://localhost:3009/api/multi-rag/search" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": 123,
    "query": "json data test",
    "limit": 5,
    "search_method": "hybrid",
    "filters": {
      "source_type": "url"
    }
  }' | jq '.'

echo -e "\n4. Testing Document Statistics..."
curl -s "http://localhost:3009/api/multi-rag/stats/123" | jq '.'

echo -e "\n5. Testing Document Retrieval..."
curl -s "http://localhost:3009/api/multi-rag/documents/123?limit=5" | jq '.'

echo -e "\n✅ Test completed!"
