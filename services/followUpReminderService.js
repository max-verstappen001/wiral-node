import logger from '../utils/logger.js';
import ChatwootService from './chatwootService.js';

class FollowUpReminderService {
    constructor() {
        this.chatwootService = new ChatwootService();
        this.reminderDelay = 60 * 60 * 1000; // 1 hr in milliseconds
        this.activeReminders = new Map(); // Track active reminder timers
        this.conversationData = new Map(); // Store conversation data for decision making
    }

    /**
     * Update conversation data for tracking and decision making
     */
    updateConversationData(conversationId, conversationData) {
        this.conversationData.set(conversationId, {
            ...conversationData,
            lastUpdated: new Date()
        });
        logger.info(`Updated conversation data for ${conversationId}`);
    }

    /**
     * Check if a conversation needs a follow-up reminder
     * @param {Object} conversationData - Conversation and contact data
     */
    shouldSendReminder(conversationData) {
        const { 
            contact, 
            lastMessage, 
            attributes, 
            hasScheduling,
            messageCount 
        } = conversationData;

        // Don't remind if they've already provided substantial information
        const hasAttributes = this.hasSignificantAttributes(attributes);
        
        // Don't remind if they've scheduled something
        if (hasScheduling) {
            return false;
        }

        // Don't remind if they've provided attributes and have multiple messages
        if (hasAttributes && messageCount > 2) {
            return false;
        }

        // Don't remind if it's been less than an hour since last message
        const timeSinceLastMessage = Date.now() - new Date(lastMessage.created_at).getTime();
        if (timeSinceLastMessage < this.reminderDelay) {
            return false;
        }

        // Send reminder if:
        // 1. Only initial message with no follow-up, OR
        // 2. Incomplete information after initial inquiry
        return !hasAttributes || messageCount <= 1;
    }

    /**
     * Check if contact has provided significant attributes
     */
    hasSignificantAttributes(attributes) {
        const significantFields = ['origin', 'destination', 'service_type', 'cargo_details', 'lead_name'];
        const providedCount = significantFields.filter(field => 
            attributes[field] && attributes[field] !== 'none' && attributes[field].trim() !== ''
        ).length;

        // Consider significant if they've provided at least 2 key attributes
        return providedCount >= 2;
    }

    /**
     * Schedule a follow-up reminder for a conversation
     */
    scheduleReminder(conversationId, accountId, contactId, apiToken) {
        // Clear any existing reminder for this conversation
        this.clearReminder(conversationId);

        const timerId = setTimeout(async () => {
            try {
                await this.sendFollowUpMessage(conversationId, accountId, contactId, apiToken);
                this.activeReminders.delete(conversationId);
            } catch (error) {
                logger.error(`Error sending follow-up reminder for conversation ${conversationId}:`, error);
            }
        }, this.reminderDelay);

        this.activeReminders.set(conversationId, timerId);
        logger.info(`Scheduled follow-up reminder for conversation ${conversationId} in 1 hour`);
    }

    /**
     * Clear a scheduled reminder
     */
    clearReminder(conversationId) {
        const existingTimer = this.activeReminders.get(conversationId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.activeReminders.delete(conversationId);
            logger.info(`Cleared follow-up reminder for conversation ${conversationId}`);
        }
    }

    /**
     * Send the actual follow-up message
     */
    async sendFollowUpMessage(conversationId, accountId, contactId, apiToken) {
        try {
            // Get stored conversation data
            const conversationData = this.conversationData.get(conversationId) || {};
            
            const reminderMessage = this.generateReminderMessage(conversationData);
            
            await this.chatwootService.sendReply(
                accountId, 
                conversationId, 
                reminderMessage, 
                apiToken
            );

            logger.info(`Sent follow-up reminder to conversation ${conversationId}`);
            
            // Clean up conversation data after sending reminder
            this.conversationData.delete(conversationId);
        } catch (error) {
            logger.error(`Failed to send follow-up reminder for conversation ${conversationId}:`, error);
        }
    }

    /**
     * Generate appropriate reminder message based on conversation state
     */
    generateReminderMessage(conversationData) {
        const { attributes, messageCount, hasScheduling } = conversationData;
        const hasAttributes = this.hasSignificantAttributes(attributes);

        // If they haven't provided any information at all
        if (!hasAttributes && messageCount <= 1) {
            return "Hi! I noticed you reached out earlier but we haven't heard back from you. I'm here to help with your shipping needs. Could you let me know what you'd like to send and where you're shipping from and to? 📦";
        }

        // If they provided some info but incomplete
        if (!hasAttributes) {
            return "Hi! Thanks for your interest in our services. I'm still here to help you with your shipping requirements. Could you please provide a bit more information about your shipment so I can assist you better? 🚢";
        }

        // If they have info but no scheduling
        if (hasAttributes && !hasScheduling) {
            return "Hi! I have your shipment details. Would you like me to help you schedule a pickup time? Just let me know when would be convenient for you! 📅";
        }

        // Generic follow-up
        return "Hi! I'm still here if you have any questions or need assistance with your shipment. Feel free to ask me anything! 😊";
    }

    /**
     * Determine if we should schedule a new reminder after this message
     */
    shouldScheduleNewReminder(messageData) {
        // Don't schedule if it's from bot/agent
        if (messageData.sender_type !== 'contact') {
            return false;
        }

        // Schedule reminder for incomplete conversations
        return true; // Let the timer logic determine if reminder is needed
    }

    /**
     * Handle new message - reset reminder timer
     */
    onNewMessage(conversationId, accountId, contactId, apiToken, messageData) {
        // Clear existing reminder since user responded
        this.clearReminder(conversationId);

        // Update conversation data
        this.updateConversationData(conversationId, messageData);

        // Check if we should schedule a new reminder
        const shouldSchedule = this.shouldScheduleNewReminder(messageData);
        
        if (shouldSchedule) {
            this.scheduleReminder(conversationId, accountId, contactId, apiToken);
        }
    }

    /**
     * Determine if we should schedule a new reminder after this message
     */
    shouldScheduleNewReminder(messageData) {
        // Don't schedule if it's from bot/agent
        if (messageData.sender_type !== 'contact') {
            return false;
        }

        // Schedule reminder for incomplete conversations
        return true; // Let the timer logic determine if reminder is needed
    }

    /**
     * Get statistics about active reminders
     */
    getReminderStats() {
        return {
            activeReminders: this.activeReminders.size,
            storedConversations: this.conversationData.size,
            reminderDelayHours: this.reminderDelay / (60 * 60 * 1000)
        };
    }
}

export default FollowUpReminderService;