# Wiral-Node Modular Architecture

## 📁 **New Modular Structure**

```
wiral-node/
├── config/
│   ├── appConfig.js          # Centralized configuration
│   └── mongoConnect.js       # Database connection
├── controllers/
│   ├── webhookController.js  # Main webhook logic
│   └── analyticsController.js # Health & analytics endpoints
├── middleware/
│   └── webhookValidator.js   # Request validation & filtering
├── services/
│   ├── chatwootService.js    # Chatwoot API interactions
│   ├── attributeService.js   # Attribute management
│   └── aiService.js          # AI/LangChain operations
├── routes/
│   └── webhookRoutes.js      # Route definitions
├── server1-modular.js        # New modular main server
└── server1.js               # Original monolithic server (backup)
```

## 🚀 **Running the Modular Server**

```bash
# Production - Modular version
npm run start:modular

# Development with auto-reload - Modular version  
npm run dev:modular

# Original server1.js (for comparison)
npm run start:server1
```

## 🔧 **Key Improvements**

### **1. Separation of Concerns**
- **Controllers**: Handle HTTP requests/responses
- **Services**: Business logic and external API calls
- **Middleware**: Request validation and filtering
- **Config**: Centralized configuration management

### **2. Maintainability**
- Each file has a single responsibility
- Easy to test individual components
- Clear dependency structure
- Reduced cognitive load

### **3. Scalability**
- Easy to add new features
- Simple to modify existing functionality
- Clear interfaces between components
- Reusable service modules

## 📋 **Module Responsibilities**

### **config/appConfig.js**
- Environment variable management
- Application constants
- Model configuration
- Pricing settings

### **services/chatwootService.js**
- Message fetching
- Reply sending
- Contact attribute updates
- Custom attribute definitions

### **services/attributeService.js**
- Attribute extraction from messages
- Change detection
- Collection timing logic
- Contact attribute management

### **services/aiService.js**
- LangChain chain initialization
- AI response generation
- Knowledge base retrieval
- Cost calculation

### **controllers/webhookController.js**
- Main webhook processing pipeline
- Orchestrates all services
- Handles error scenarios
- Langfuse integration

### **middleware/webhookValidator.js**
- Bot loop prevention
- Message validation
- Data extraction
- Request filtering

## 🔄 **Migration Notes**

The modular version (`server1-modular.js`) maintains **100% functional compatibility** with the original `server1.js`:

- ✅ All webhook processing logic preserved
- ✅ Attribute collection system intact
- ✅ AI response generation unchanged
- ✅ Langfuse integration maintained
- ✅ Error handling preserved
- ✅ Logging functionality intact

## 🎯 **Benefits of Modularization**

1. **Code Readability**: Each file focuses on one responsibility
2. **Testing**: Easier to unit test individual components
3. **Debugging**: Faster to locate issues
4. **Collaboration**: Multiple developers can work on different modules
5. **Maintenance**: Updates to one module don't affect others
6. **Reusability**: Services can be used across different parts of the application

## 🔧 **Development Workflow**

```bash
# Start development server with auto-reload
npm run dev:modular

# Check logs for any issues
tail -f bot.log

# Test the webhook endpoint
curl -X POST http://localhost:3009/chatwoot-webhook \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

## 📝 **Future Enhancements**

With this modular structure, it's now easy to:
- Add new service integrations
- Implement caching layers
- Add request rate limiting
- Implement advanced analytics
- Add automated testing
- Implement API versioning
