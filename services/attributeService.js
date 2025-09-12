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
        // Get the base contact attributes
        let contactAttributes = this.chatwootService.extractContactAttributesFromWebhook(body);
        
        // If no attributes exist, initialize empty object
        if (!contactAttributes || typeof contactAttributes !== 'object') {
            contactAttributes = {};
        }

        // Auto-populate contact number from WhatsApp if channel is WhatsApp and contact number is missing
        const channelType = body?.inbox?.channel_type || body?.conversation?.inbox?.channel_type;
        const isWhatsApp = channelType === 'Channel::Whatsapp' || 
                          (body?.inbox?.name && body.inbox.name.toLowerCase().includes('whatsapp'));

        if (isWhatsApp && !contactAttributes.lead_contact_number) {
            // Extract phone number from WhatsApp contact
            const phoneNumber = this.extractWhatsAppPhoneNumber(body);
            if (phoneNumber) {
                contactAttributes.lead_contact_number = phoneNumber;
                logger.info(`Auto-populated contact number from WhatsApp: ${phoneNumber}`);
            }
        }

        return contactAttributes;
    }

    /**
     * Extract phone number from WhatsApp webhook data
     */
    extractWhatsAppPhoneNumber(body) {
        try {
            // Method 1: From conversation contact identifier (most reliable)
            const contactIdentifier = body?.conversation?.meta?.sender?.identifier || 
                                    body?.sender?.identifier ||
                                    body?.conversation?.contact_inbox?.source_id;

            if (contactIdentifier) {
                // WhatsApp identifiers are usually in format like "918234567890" or "+918234567890"
                const cleanNumber = this.formatPhoneNumber(contactIdentifier);
                if (cleanNumber) {
                    return cleanNumber;
                }
            }

            // Method 2: From contact phone number field
            const phoneNumber = body?.conversation?.meta?.sender?.phone_number ||
                              body?.sender?.phone_number ||
                              body?.conversation?.contact_inbox?.contact?.phone_number;

            if (phoneNumber) {
                return this.formatPhoneNumber(phoneNumber);
            }

            // Method 3: From contact name if it contains a number
            const contactName = body?.conversation?.meta?.sender?.name ||
                              body?.sender?.name ||
                              body?.conversation?.contact_inbox?.contact?.name;

            if (contactName && /^\+?\d+$/.test(contactName.trim())) {
                return this.formatPhoneNumber(contactName);
            }

            logger.info('Could not extract phone number from WhatsApp webhook data');
            return null;

        } catch (error) {
            logger.error('Error extracting WhatsApp phone number:', error);
            return null;
        }
    }

    /**
     * Format phone number to a consistent format
     */
    formatPhoneNumber(phoneNumber) {
        if (!phoneNumber) return null;

        // Remove all non-digit characters except +
        let cleaned = phoneNumber.toString().replace(/[^\d+]/g, '');

        // If it starts with +, keep it, otherwise add +
        if (!cleaned.startsWith('+')) {
            cleaned = '+' + cleaned;
        }

        // Basic validation: should have at least 10 digits after country code
        const digitsOnly = cleaned.replace(/\D/g, '');
        if (digitsOnly.length >= 10) {
            return cleaned;
        }

        return null;
    }
}

export default AttributeService;
