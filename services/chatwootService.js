import axios from "axios";
import logger from "../utils/logger.js";
import { config } from "../config/appConfig.js";

class ChatwootService {
    constructor() {
        this.baseUrl = config.CHATWOOT_URL;
    }

    async fetchLastMessages(accountId, conversationId, limit = 20, apiAccessToken) {
        try {
            const res = await axios.get(
                `${this.baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages?per_page=100`,
                {
                    headers: { 
                        "Content-Type": "application/json", 
                        api_access_token: apiAccessToken 
                    },
                    timeout: 10000,
                }
            );
            const all = Array.isArray(res.data) ? res.data : res.data?.payload || [];
            return all.slice(-limit);
        } catch (error) {
            logger.error(`Error fetching messages for conversation ${conversationId}:`, error.message);
            throw error;
        }
    }

    async sendReply(accountId, conversationId, content, botToken) {
        try {
            await axios.post(
                `${this.baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
                { content, message_type: "outgoing" },
                {
                    headers: { 
                        "Content-Type": "application/json", 
                        api_access_token: botToken 
                    },
                    timeout: 10000,
                }
            );
            logger.info(`Reply sent to conversation ${conversationId}`);
        } catch (error) {
            logger.error(`Error sending reply to conversation ${conversationId}:`, error.message);
            throw error;
        }
    }

    async updateContactAttributes(accountId, contactId, attributes, apiAccessToken) {
        try {
            await axios.put(
                `${this.baseUrl}/api/v1/accounts/${accountId}/contacts/${contactId}`,
                { custom_attributes: attributes },
                {
                    headers: { 
                        "Content-Type": "application/json", 
                        api_access_token: apiAccessToken 
                    },
                    timeout: 10000,
                }
            );
            logger.info(`Updated contact ${contactId} attributes:`, attributes);
        } catch (error) {
            logger.error(`Error updating contact attributes for contact ${contactId}:`, error.message);
            throw error;
        }
    }

    async getCustomAttributeDefinitions(accountId, apiAccessToken) {
        try {
            const { data: defs } = await axios.get(
                `${this.baseUrl}/api/v1/accounts/${accountId}/custom_attribute_definitions`,
                {
                    headers: { 
                        "Content-Type": "application/json", 
                        api_access_token: apiAccessToken 
                    },
                    params: { attribute_model: 1 },
                    timeout: 10000,
                }
            );
            logger.info(`Fetched ${defs.length} attribute definitions for account ${accountId}`);
            return defs || [];
        } catch (error) {
            logger.error(`Error fetching attributes for account ${accountId}:`, error.message);
            return [];
        }
    }

    // Utility: Extract contact attributes from webhook payload
    extractContactAttributesFromWebhook(body) {
        logger.info(`Extracting contact attributes from webhook payload: ${JSON.stringify(body?.conversation?.meta?.sender?.custom_attributes, null, 2)}`);
        return body?.sender?.custom_attributes
            || body?.conversation?.meta?.sender?.custom_attributes
            || (body?.conversation?.messages?.[0]?.sender?.custom_attributes)
            || null;
    }
}

export default ChatwootService;
