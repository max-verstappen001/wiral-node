import express from "express";
import WebhookController from "../controllers/webhookController.js";
import AnalyticsController from "../controllers/analyticsController.js";

const router = express.Router();
const webhookController = new WebhookController();
const analyticsController = new AnalyticsController();

// Webhook routes
router.post("/chatwoot-webhook", webhookController.handleChatwootWebhook.bind(webhookController));

// Health and Analytics routes
router.get("/health", analyticsController.getHealthCheck.bind(analyticsController));
router.get("/api/analytics/:accountId", analyticsController.getAccountAnalytics.bind(analyticsController));
router.post("/api/test-external-api", analyticsController.testExternalAPI.bind(analyticsController));

export default router;
