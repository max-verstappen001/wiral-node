import logger from "../utils/logger.js";
import sharedLangfuseService from "../utils/langfuse.js";
import os from "os";

class AnalyticsController {
    async getHealthCheck(req, res) {
        try {
            const langfuseHealth = await sharedLangfuseService.healthCheck();

            res.json({
                status: "OK",
                timestamp: new Date().toISOString(),
                hostname: os.hostname(),
                pid: process.pid,
                memoryUsage: process.memoryUsage(),
                services: {
                    rag: "enabled",
                    chatwoot: "enabled",
                    langfuse: langfuseHealth.status,
                    langfuse_message: langfuseHealth.message,
                    attribute_collection: "enabled",
                    smart_timing: "enabled"
                }
            });
        } catch (error) {
            logger.error("Health check error:", error.message);
            res.status(500).json({
                status: "ERROR",
                error: error.message
            });
        }
    }

    async getAccountAnalytics(req, res) {
        try {
            const { accountId } = req.params;
            const { days = 30 } = req.query;

            const analytics = await sharedLangfuseService.getAccountAnalytics(accountId, parseInt(days));

            res.json({
                success: true,
                account_id: accountId,
                period_days: days,
                analytics: analytics
            });
        } catch (error) {
            logger.error(`Error fetching analytics for account ${req.params.accountId}:`, error.message);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async testExternalAPI(req, res) {
        try {
            const { accountId, contactData, attributes } = req.body;
            // contactData should be contactId (string or number), not an object
            const contactId = typeof contactData === 'object' && contactData.contact_id ? contactData.contact_id : contactData;
            
            // This would typically call an external service
            // For now, we'll just return success
            logger.info(`Testing external API for account ${accountId}, contact ${contactId}`, attributes);

            res.json({
                success: true,
                message: "External API test completed",
                account_id: accountId,
                contact_id: contactId,
                attributes: attributes
            });
        } catch (error) {
            logger.error(`Error testing external API:`, error.message);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

export default AnalyticsController;
