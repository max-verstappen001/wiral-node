import express from "express";
import cors from "cors";
import logger from "./utils/logger.js";
import { config } from "./config/appConfig.js";
import mongoConnect from "./config/mongoConnect.js";
import sharedLangfuseService from "./utils/langfuse.js";

// Import existing route modules
import ragRoutes from "./routes/ragRoutes.js";
import enhancedRagRoutes from "./routes/enhancedRagRoutes.js";
import azureUploadRoutes from "./routes/azureUploadRoutes.js";
import azureRagRoutes from "./routes/azureRagRoutes.js";
import multiFileRagRoutes from "./routes/multiFileRagRoutes.js";

// Import new modularized routes
import webhookRoutes from "./routes/webhookRoutes.js";

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

app.use(cors({
    origin: "*", // Consider restricting this for better security
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Mount existing RAG routes
app.use("/api/rag", ragRoutes);
app.use("/api/rag-enhanced", enhancedRagRoutes);
app.use("/api/azure", azureUploadRoutes);
app.use("/api/azure-rag", azureRagRoutes);
app.use("/api/multi-rag", multiFileRagRoutes);

// Mount new modularized routes
app.use("/", webhookRoutes);

// Server startup function
async function startServer() {
    try {
        console.log("Starting enhanced server...");

        // Connect to MongoDB
        await mongoConnect();

        // Initialize Langfuse service
        await sharedLangfuseService.initialize();

        app.listen(config.PORT, () => {
            logger.info(`Enhanced AI Bot with RAG service and Smart Attribute Collection running on port ${config.PORT}`);
            logger.info("Environment check:");
            logger.info(`- CHATWOOT_URL: ${config.CHATWOOT_URL ? "Set" : "Missing"}`);
            logger.info(`- OPENAI_API_KEY: ${config.OPENAI_API_KEY ? "Set" : "Missing"}`);
            logger.info(`- MONGODB_URI: ${config.MONGODB_URI ? "Set" : "Missing"}`);
            logger.info(`- LANGFUSE_ENABLED: ${config.LANGFUSE_ENABLED ? "Set" : "Missing"}`);
            logger.info(`- LANGFUSE_BASE_URL: ${config.LANGFUSE_BASE_URL ? "Set" : "Missing"}`);
            logger.info(`- LANGFUSE_PUBLIC_KEY: ${config.LANGFUSE_PUBLIC_KEY ? "Set" : "Missing"}`);
            logger.info(`- LANGFUSE_SECRET_KEY: ${config.LANGFUSE_SECRET_KEY ? "Set" : "Missing"}`);
            logger.info("MongoDB connection: Enabled");
            logger.info("Features: RAG, Smart Attribute Collection, Dynamic Client Support, Professional Timing");
        });
    } catch (error) {
        logger.error("Failed to start server: " + error.message);
        process.exit(1);
    }
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await sharedLangfuseService.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await sharedLangfuseService.shutdown();
    process.exit(0);
});

// Start the server
startServer();
