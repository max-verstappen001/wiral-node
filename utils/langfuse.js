// services/SharedLangfuseService.js - Single Langfuse account for all users
import { Langfuse } from "langfuse";
import dotenv from "dotenv";

dotenv.config();

class SharedLangfuseService {
    constructor() {
        this.langfuse = null;
        this.isEnabled = process.env.LANGFUSE_ENABLED !== 'false';
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return this.langfuse;

        try {
            if (!this.isEnabled) {
                console.log('Langfuse tracking disabled');
                return null;
            }

            // Single Langfuse instance for all accounts
            this.langfuse = new Langfuse({
                secretKey: process.env.LANGFUSE_SECRET_KEY,
                publicKey: process.env.LANGFUSE_PUBLIC_KEY,
                baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com"
            });

            this.initialized = true;
            console.log('✅ Shared Langfuse service initialized');
            return this.langfuse;

        } catch (error) {
            console.error('❌ Failed to initialize Langfuse:', error);
            this.isEnabled = false;
            return null;
        }
    }

    async createTrace(accountId, sessionId, input, metadata = {}) {
        if (!this.isEnabled || !this.langfuse) return null;

        try {
            const trace = this.langfuse.trace({
                name: "rag_operation",
                userId: accountId, // Use account_id as user identifier
                sessionId: sessionId,
                input: input,
                metadata: {
                    account_id: accountId,
                    service: "rag_api",
                    version: "1.0.0",
                    ...metadata
                },
                tags: ["rag", "production", accountId]
            });

            return trace;
        } catch (error) {
            console.error('Error creating Langfuse trace:', error);
            return null;
        }
    }

    async createSpan(trace, name, input, metadata = {}) {
        if (!trace) return null;

        try {
            const span = trace.span({
                name: name,
                input: input,
                metadata: metadata
            });

            return span;
        } catch (error) {
            console.error('Error creating Langfuse span:', error);
            return null;
        }
    }

    async updateTrace(trace, output, metadata = {}) {
        if (!trace) return;

        try {
            trace.update({
                output: output,
                metadata: metadata
            });
        } catch (error) {
            console.error('Error updating Langfuse trace:', error);
        }
    }

    async logUsage(accountId, usageData) {
        if (!this.isEnabled || !this.langfuse) return;

        try {
            // Log usage as a generation event
            this.langfuse.generation({
                name: "api_usage",
                model: usageData.model || "unknown",
                input: usageData.input,
                output: usageData.output,
                metadata: {
                    account_id: accountId,
                    endpoint: usageData.endpoint,
                    tokens_used: usageData.tokens_used,
                    cost: usageData.cost,
                    processing_time: usageData.processing_time,
                    success: usageData.success
                },
                usage: {
                    input: usageData.input_tokens || 0,
                    output: usageData.output_tokens || 0,
                    total: usageData.tokens_used || 0
                }
            });

        } catch (error) {
            console.error('Error logging usage to Langfuse:', error);
        }
    }

    async logCost(accountId, costData) {
        if (!this.isEnabled || !this.langfuse) return;

        try {
            // Log cost information as an event
            this.langfuse.event({
                name: "cost_tracking",
                input: costData,
                metadata: {
                    account_id: accountId,
                    transaction_type: costData.transaction_type,
                    amount: costData.amount,
                    balance_before: costData.balance_before,
                    balance_after: costData.balance_after,
                    pricing_tier: costData.pricing_tier
                }
            });

        } catch (error) {
            console.error('Error logging cost to Langfuse:', error);
        }
    }

    async flush() {
        if (!this.langfuse) return;

        try {
            await this.langfuse.flushAsync();
        } catch (error) {
            console.error('Error flushing Langfuse:', error);
        }
    }

    async shutdown() {
        if (this.langfuse) {
            try {
                await this.langfuse.flushAsync();
                console.log('✅ Langfuse service shutdown gracefully');
            } catch (error) {
                console.error('Error during Langfuse shutdown:', error);
            }
        }
    }

    // Account-specific analytics using shared Langfuse
    async getAccountAnalytics(accountId, days = 30) {
        if (!this.isEnabled || !this.langfuse) return null;

        try {

            console.log(`Analytics for account ${accountId} available in Langfuse dashboard (filter by userId: ${accountId})`);
            return {
                message: "Check Langfuse dashboard for detailed analytics",
                filter_by: `userId: ${accountId}`,
                dashboard_url: process.env.LANGFUSE_BASE_URL
            };

        } catch (error) {
            console.error('Error getting Langfuse analytics:', error);
            return null;
        }
    }

    // Health check for Langfuse connection
    async healthCheck() {
        if (!this.isEnabled) {
            return { status: 'disabled', message: 'Langfuse tracking is disabled' };
        }

        if (!this.langfuse) {
            return { status: 'error', message: 'Langfuse not initialized' };
        }

        try {
            // Test with a simple trace
            const testTrace = this.langfuse.trace({
                name: "health_check",
                userId: "system",
                input: { test: true }
            });

            testTrace.update({ output: { healthy: true } });
            await this.langfuse.flushAsync();

            return { status: 'healthy', message: 'Langfuse connection working' };

        } catch (error) {
            console.error('Langfuse health check failed:', error);
            return { status: 'error', message: error.message };
        }
    }
}

// Create singleton instance
const sharedLangfuseService = new SharedLangfuseService();

// Initialize on import
sharedLangfuseService.initialize();

export default sharedLangfuseService;
