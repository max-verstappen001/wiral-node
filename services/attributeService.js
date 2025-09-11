import logger from "../utils/logger.js";
import AttributeExtractor from "../utils/attributeExtraction.js";
import { Client } from "../model/clientModel.js";
import ChatwootService from "./chatwootService.js";

class AttributeService {
    constructor() {
        this.attributeExtractor = new AttributeExtractor(logger);
        this.chatwootService = new ChatwootService();
    }

    async getRequiredAttributes(accountId) {
        try {
            const client = await Client.findOne({ account_id: accountId, is_active: true });
            if (!client || !client.api_key) {
                logger.error(`[DEBUG] No active client or api_key found for account ${accountId}`);
                return [];
            }
            
            return await this.chatwootService.getCustomAttributeDefinitions(accountId, client.api_key);
        } catch (error) {
            logger.error(`[DEBUG] Error fetching attributes for account ${accountId}:`, error.message);
            return [];
        }
    }

    checkMissingAttributes(requiredAttributes, currentAttributes) {
        const missing = [];
        for (const attr of requiredAttributes) {
            if (!currentAttributes[attr.attribute_key] || currentAttributes[attr.attribute_key] === '') {
                missing.push(attr);
            }
        }
        return missing;
    }

    async processAttributeChanges(content, currentContactAttributes, requiredAttributes, apiAccessToken, accountId, contactId) {
        try {
            return await this.attributeExtractor.processAttributeChanges(
                content,
                currentContactAttributes,
                requiredAttributes,
                apiAccessToken,
                accountId,
                contactId
            );
        } catch (error) {
            logger.error(`Error processing attribute changes:`, error.message);
            return {
                hasChanges: false,
                success: false,
                error: error.message
            };
        }
    }

    async extractAttributesFromMessage(content, requiredAttributes) {
        try {
            return await this.attributeExtractor.extractAllAttributesFromMessage(content, requiredAttributes);
        } catch (error) {
            logger.error(`Error extracting attributes from message:`, error.message);
            return {};
        }
    }

    shouldCollectAttributes(lastMessages, missingAttributes) {
        try {
            return this.attributeExtractor.shouldCollectAttributes(lastMessages, missingAttributes);
        } catch (error) {
            logger.error(`Error in shouldCollectAttributes:`, error.message);
            return {
                shouldCollect: false,
                reason: 'error_in_timing_analysis',
                attributesToCollect: [],
                turnCount: 0
            };
        }
    }

    async updateContactAttributes(accountId, contactId, attributes, apiAccessToken) {
        try {
            await this.chatwootService.updateContactAttributes(accountId, contactId, attributes, apiAccessToken);
            return true;
        } catch (error) {
            logger.error(`Error updating contact attributes:`, error.message);
            return false;
        }
    }

    extractContactAttributesFromWebhook(body) {
        return this.chatwootService.extractContactAttributesFromWebhook(body);
    }
}

export default AttributeService;
