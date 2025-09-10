# Attribute Extraction Testing Suite

This testing suite provides comprehensive tools for testing the universal attribute extraction system with different client configurations and business domains.

## 🚀 Quick Start

### 1. Run Quick Tests
```bash
node quick-test-attributes.js
```
For interactive testing:
```bash
node quick-test-attributes.js --interactive
```

### 2. Test Specific Client Types
```bash
node config-test-runner.js logistics      # Test logistics client
node config-test-runner.js healthcare     # Test healthcare client
node config-test-runner.js real_estate    # Test real estate client
node config-test-runner.js ecommerce      # Test e-commerce client
node config-test-runner.js financial      # Test financial services
node config-test-runner.js education      # Test education platform
```

### 3. Test All Configurations
```bash
node config-test-runner.js all
```

### 4. Comprehensive Test Suite
```bash
node test-attribute-extraction.js
```

## 🎮 Interactive Testing

Launch interactive mode to test custom messages:
```bash
node config-test-runner.js --interactive
```

## 🔄 Change Detection Testing

Test attribute change detection for specific client:
```bash
node config-test-runner.js --change logistics
```

## ⚡ Performance Benchmarking

Benchmark extraction performance:
```bash
node config-test-runner.js --benchmark logistics 20
```

## 📁 Test Files

### Core Test Files
- **`test-attribute-extraction.js`** - Comprehensive test suite with all scenarios
- **`quick-test-attributes.js`** - Quick testing for development
- **`config-test-runner.js`** - Configuration-based testing system
- **`test-configurations.json`** - Client attribute configurations

### Test Configurations

The `test-configurations.json` file contains pre-configured client setups for:

1. **Logistics & Transportation** - Package delivery, pickup/delivery locations, urgency levels
2. **Healthcare Services** - Patient management, appointments, medical information
3. **Real Estate** - Property search, budgets, locations, features
4. **E-Commerce** - Product categories, shipping, payments, delivery preferences
5. **Financial Services** - Loans, investments, risk tolerance, income
6. **Education** - Course levels, subjects, learning modes, schedules

## 🧪 Testing Features

### Universal Extraction Testing
- ✅ Multi-industry client support
- ✅ Dynamic attribute type detection
- ✅ AI-powered extraction with GPT-4o-mini
- ✅ Contextual and pattern-based fallbacks
- ✅ Value processing and validation

### Change Detection Testing
- ✅ Intent recognition ("I want to change...")
- ✅ Explicit value changes ("Change X to Y")
- ✅ Implicit value updates (contradiction detection)
- ✅ Clarification questions for missing values

### Error Handling Testing
- ✅ Null/undefined input handling
- ✅ Empty attribute arrays
- ✅ Invalid configurations
- ✅ AI extraction failures

### Performance Testing
- ✅ Extraction speed benchmarking
- ✅ Memory usage monitoring
- ✅ Concurrent request handling
- ✅ Large message processing

## 📊 Test Results

Tests generate detailed results showing:
- Extraction success rates per client type
- Individual attribute extraction accuracy
- Performance metrics (timing)
- Detailed error information
- Recommendations for improvements

Example output:
```
📦 Testing Logistics Client Attributes
────────────────────────────────────────
📝 Test 1: "I need to send a laptop from 123 Main Street to 456 Oak Avenue. It's urgent and weighs about 2kg."
✅ Pickup Location: "123 Main Street"
✅ Delivery Location: "456 Oak Avenue"
✅ Package Type: "Electronics"
✅ Delivery Urgency: "Urgent"
✅ Package Weight: "2kg"
🎉 Test 1 PASSED

📊 Results: 4/4 tests passed (100.0%)
```

## 🛠️ Customizing Tests

### Adding New Client Types

1. Edit `test-configurations.json`
2. Add new client configuration:
```json
"your_client": {
  "name": "Your Client Name",
  "description": "Description of your business domain",
  "attributes": [
    {
      "attribute_key": "your_attribute",
      "attribute_display_name": "Your Attribute",
      "attribute_description": "Detailed description for AI extraction",
      "attribute_values": ["Option1", "Option2"] // Optional for enums
    }
  ],
  "test_messages": [
    "Test message containing your attributes"
  ]
}
```

### Creating Custom Tests

Modify `quick-test-attributes.js` testCustomAttributes() method:
```javascript
const customAttributes = [
  {
    attribute_key: 'your_custom_attribute',
    attribute_display_name: 'Your Custom Attribute',
    attribute_description: 'Description for extraction',
    attribute_values: [] // Or predefined values
  }
];

const customMessage = "Your test message";
```

## 🔧 Integration Testing

### Testing with Real Webhook Data

To test with actual webhook payloads:

1. Copy real message content from your webhook logs
2. Use the interactive testing mode
3. Test with your actual client attribute configurations

### Testing Chatwoot Integration

The tests use the same AttributeExtractor class that your webhook uses, ensuring identical behavior.

## 📈 Best Practices

### Attribute Design
- Use descriptive `attribute_key` names (snake_case)
- Provide clear `attribute_display_name` for user interaction
- Write detailed `attribute_description` for AI extraction
- Include `attribute_values` for classification/enum types

### Test Message Design
- Use natural conversational language
- Include multiple attributes in single messages
- Test edge cases and ambiguous inputs
- Verify extraction with different sentence structures

### Validation
- Check extracted values match expected format
- Verify classification values match predefined options
- Test with missing, partial, and complete information
- Ensure system handles unknown attributes gracefully

## 🚨 Troubleshooting

### Common Issues

1. **No attributes extracted**
   - Check if OpenAI API key is set
   - Verify attribute descriptions are descriptive
   - Test with more explicit messages

2. **Wrong classification values**
   - Ensure `attribute_values` array is properly defined
   - Check that test messages contain recognizable terms

3. **Performance issues**
   - AI extraction takes 1-3 seconds normally
   - Use performance benchmarking to identify bottlenecks

### Environment Setup

Ensure you have:
```bash
export OPENAI_API_KEY="your-api-key"
export CHATWOOT_URL="your-chatwoot-url"
```

## 📝 Test Reports

Tests generate JSON reports in the format:
```json
{
  "timestamp": "2025-09-10T...",
  "summary": {
    "totalClients": 6,
    "totalTests": 24,
    "totalPassed": 22
  },
  "clientResults": {
    "logistics": {
      "name": "Logistics & Transportation",
      "totalTests": 4,
      "passedTests": 4,
      "successRate": 100.0
    }
  }
}
```

## 🎯 Success Metrics

The testing suite measures:
- **Extraction Accuracy**: % of correctly extracted attributes
- **Client Coverage**: Support across different business domains
- **Performance**: Extraction speed and reliability
- **Change Detection**: Accuracy of intent recognition
- **Error Handling**: Graceful failure management

Target success rates:
- **90%+**: Excellent - Production ready
- **70-89%**: Good - Minor improvements needed
- **<70%**: Needs improvement - Review extraction logic
