import logger from "../utils/logger.js";

class WebhookValidator {
    static shouldIgnoreMessage(req) {
        const { content, sender, message_type } = req.body;
        const messageSenderType = req.body.conversation?.messages?.[0]?.sender_type;
        
        // Method 1: Check sender type from message object
        if (messageSenderType === "AgentBot" || messageSenderType === "Agent") {
            logger.info(`Ignoring message from bot/agent. Sender type: ${messageSenderType}`);
            return true;
        }
        
        // Method 2: Only process messages from contacts/users
        if (messageSenderType && messageSenderType !== "Contact") {
            logger.info(`Ignoring non-contact message. Sender type: ${messageSenderType}`);
            return true;
        }
        
        // Method 3: Fallback check on top-level sender
        if (sender?.type && sender.type !== "contact") {
            logger.info(`Ignoring non-contact message. Top-level sender type: ${sender?.type}`);
            return true;
        }
        
        // Method 4: Check message type (incoming vs outgoing)
        if (message_type && message_type !== "incoming") {
            logger.info(`Ignoring ${message_type} message`);
            return true;
        }
        
        // Method 5: Additional check for empty content
        if (!content || String(content).trim() === "") {
            logger.info(`Ignoring empty message`);
            return true;
        }
        
        return false;
    }

    static extractWebhookData(req) {
        const { content, conversation, message_type } = req.body;
        const account_id = req.body.account?.id;
        const contact_id = req.body.conversation?.contact_inbox?.contact_id;
        const conversationId = conversation?.id;
        const accountName = req.body.account?.name || `Account ${account_id}`;

        return {
            content,
            conversation,
            message_type,
            account_id,
            contact_id,
            conversationId,
            accountName
        };
    }

    static validateWebhookData(webhookData) {
        const { account_id, contact_id, conversationId, content } = webhookData;
        
        if (!account_id) {
            logger.error('Missing account_id in webhook data');
            return false;
        }
        
        if (!contact_id) {
            logger.error('Missing contact_id in webhook data');
            return false;
        }
        
        if (!conversationId) {
            logger.error('Missing conversationId in webhook data');
            return false;
        }
        
        if (!content) {
            logger.error('Missing content in webhook data');
            return false;
        }
        
        return true;
    }
}

export default WebhookValidator;
