import dotenv from "dotenv";

dotenv.config();

export const config = {
    // Server
    PORT: process.env.PORT || 3009,
    
    // APIs
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    CHATWOOT_URL: process.env.CHATWOOT_URL,
    
    // Database
    MONGODB_URI: process.env.MONGODB_URI,
    
    // Langfuse
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_ENABLED: process.env.LANGFUSE_ENABLED,
    
    // Azure
    AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING,
    CONTAINER_NAME: process.env.CONTAINER_NAME,
    STORAGE_NAME: process.env.STORAGE_NAME,
    
    // AI Model Configuration
    MODEL: "gpt-4o-mini",
    EMBEDDING_MODEL: "text-embedding-3-small",
    
    // Pricing (per 1K tokens)
    PRICING: {
        "gpt-4o-mini": {
            input: Number(process.env.MODEL_PRICING_GPT4O_MINI_INPUT || 0.15),
            output: Number(process.env.MODEL_PRICING_GPT4O_MINI_OUTPUT || 0.60),
        },
    }
};
