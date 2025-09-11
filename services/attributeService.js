import logger from "../utils/logger.js";
import AIAttributeExtractor from "./aiAttributeExtractor.js";
import { Client } from "../model/clientModel.js";
import ChatwootService from "./chatwootService.js";

class AttributeService {
    constructor() {
        this.aiAttributeExtractor = new AIAttributeExtractor();
        this.chatwootService = new ChatwootService();
    }

    async getRequiredAttributes(accountId) {
        try {
            const client = await Client.findOne({ account_id: accountId, is_active: true });
            if (!client || !client.api_key) {
                logger.error(`No active client or api_key found for account ${accountId}`);
                return [];
            }
            
            return await this.chatwootService.getCustomAttributeDefinitions(accountId, client.api_key);
        } catch (error) {
            logger.error(`Error fetching attributes for account ${accountId}:`, error.message);
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
            const changeResult = await this.aiAttributeExtractor.detectAttributeChangeIntent(
                content,
                currentContactAttributes,
                requiredAttributes
            );

            if (changeResult.hasChangeIntent) {
                logger.info(`AI detected change intent:`, changeResult);
                
                if (changeResult.attributeKey && changeResult.newValue) {
                    // We have both attribute and value, proceed with update
                    const updateData = { [changeResult.attributeKey]: changeResult.newValue };
                    await this.chatwootService.updateContactAttributes(accountId, contactId, {
                        ...currentContactAttributes,
                        ...updateData
                    }, apiAccessToken);

                    return {
                        hasChanges: true,
                        success: true,
                        changeDetails: updateData,
                        confirmationMessage: `I've updated your ${changeResult.attributeKey} to "${changeResult.newValue}". How else can I help you?`
                    };
                } else if (changeResult.attributeKey && !changeResult.newValue) {
                    // We know what to change but need the new value
                    const attrDef = requiredAttributes.find(attr => attr.attribute_key === changeResult.attributeKey);
                    const displayName = attrDef?.attribute_display_name || changeResult.attributeKey;
                    
                    return {
                        hasChanges: true,
                        success: false,
                        needsValue: true,
                        clarificationQuestion: `What would you like to change your ${displayName} to?`
                    };
                } else if (changeResult.needsConfirmation) {
                    return {
                        hasChanges: true,
                        success: false,
                        needsConfirmation: true,
                        clarificationQuestion: changeResult.reasoning || "Could you please clarify what you'd like to change?"
                    };
                }
            }

            return {
                hasChanges: false,
                success: false
            };
        } catch (error) {
            logger.error(`Error processing AI attribute changes:`, error.message);
            return {
                hasChanges: false,
                success: false,
                error: error.message
            };
        }
    }

    async extractAttributesFromMessage(content, requiredAttributes, conversationContext = []) {
        try {
            return await this.aiAttributeExtractor.extractAllAttributesFromMessage(
                content, 
                requiredAttributes, 
                conversationContext
            );
        } catch (error) {
            logger.error(`Error extracting attributes from message:`, error.message);
            return {};
        }
    }

    async shouldCollectAttributes(lastMessages, missingAttributes) {
        try {
            return await this.aiAttributeExtractor.shouldCollectAttributes(lastMessages, missingAttributes);
        } catch (error) {
            logger.error(`Error in shouldCollectAttributes:`, error.message);
            return {
                shouldCollect: false,
                reason: 'error_in_ai_timing_analysis',
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
