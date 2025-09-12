import logger from "../utils/logger.js";
import { Client } from "../model/clientModel.js";
import WebhookValidator from "../middleware/webhookValidator.js";
import ChatwootService from "../services/chatwootService.js";
import AttributeService from "../services/attributeService.js";
import AIService from "../services/aiService.js";
import LeadClassificationService from "../services/leadClassificationService.js";
import SchedulingService from "../services/schedulingService.js";
import GoogleCalendarService from "../services/googleCalendarService.js";
import FollowUpReminderService from "../services/followUpReminderService.js";
import BookingConfirmationService from "../services/bookingConfirmationService.js";
import sharedLangfuseService from "../utils/langfuse.js";
import { config } from "../config/appConfig.js";

class WebhookController {
    constructor() {
        this.chatwootService = new ChatwootService();
        this.attributeService = new AttributeService();
        this.aiService = new AIService();
        this.leadClassificationService = new LeadClassificationService();
        this.schedulingService = new SchedulingService();
        this.googleCalendarService = new GoogleCalendarService();
        this.followUpReminderService = new FollowUpReminderService();
        this.bookingConfirmationService = new BookingConfirmationService();
    }

    async handleChatwootWebhook(req, res) {
        try {
            // Step 1: Validate and extract webhook data
            if (WebhookValidator.shouldIgnoreMessage(req)) {
                return res.sendStatus(200);
            }

            const webhookData = WebhookValidator.extractWebhookData(req);
            
            if (!WebhookValidator.validateWebhookData(webhookData)) {
                return res.status(400).json({ error: "Invalid webhook data" });
            }

            const { content, account_id, contact_id, conversationId, accountName } = webhookData;

            // logger.info(`Webhook received: ${JSON.stringify(req.body, null, 2)}`);
            logger.info(`Account ID: ${account_id}, Contact ID: ${contact_id}`);

            // Step 2: Validate client configuration
            const client = await Client.findOne({ account_id: account_id, is_active: true });
            if (!client) {
                logger.info(`No active client found for account_id ${account_id}. Skipping AI response.`);
                return res.sendStatus(200);
            }

            const { bot_api_key: CHATWOOT_BOT_TOKEN, api_key: api_access_token, system_prompt: systemPrompt } = client;

            if (!CHATWOOT_BOT_TOKEN || !api_access_token) {
                logger.warn(`Missing API keys for account_id ${account_id}. Cannot proceed.`);
                return res.sendStatus(200);
            }

            // Step 3: Get required attributes and conversation context
            const requiredAttributes = await this.attributeService.getRequiredAttributes(account_id);
            logger.info(`Found ${requiredAttributes.length} required attributes for account ${account_id}`);

            const lastMessages = await this.chatwootService.fetchLastMessages(account_id, conversationId, 20, api_access_token);
            logger.info(`Fetched ${lastMessages.length} recent messages for context.`);

            // Step 4: Get current contact attributes
            let currentContactAttributes = this.attributeService.extractContactAttributesFromWebhook(req.body);
            if (!currentContactAttributes || typeof currentContactAttributes !== 'object') {
                currentContactAttributes = {};
                logger.info(`Initialized empty contact attributes object`);
            } else {
                logger.info(`Current contact attributes (from webhook):`, currentContactAttributes);
            }

            // Step 5: Process attribute changes
            logger.info(`=== CHECKING FOR ATTRIBUTE CHANGES ===`);
            const changeResult = await this.attributeService.processAttributeChanges(
                content,
                currentContactAttributes,
                requiredAttributes,
                api_access_token,
                account_id,
                contact_id
            );

            logger.info(`Change result:`, changeResult);

            // Handle attribute change scenarios
            if (changeResult.hasChanges) {
                if (changeResult.success) {
                    await this.chatwootService.sendReply(account_id, conversationId, changeResult.confirmationMessage, CHATWOOT_BOT_TOKEN);
                    return res.sendStatus(200);
                } else if (changeResult.needsValue || changeResult.needsConfirmation) {
                    await this.chatwootService.sendReply(account_id, conversationId, changeResult.clarificationQuestion, CHATWOOT_BOT_TOKEN);
                    return res.sendStatus(200);
                } else {
                    logger.error(`Attribute change failed:`, changeResult.error);
                }
            }

            // Step 6: Extract new attributes from message
            logger.info(`=== EXTRACTING NEW ATTRIBUTES ===`);
            let updatedAttributes = { ...currentContactAttributes };
            let attributesUpdated = false;

            const missingAttributes = this.attributeService.checkMissingAttributes(requiredAttributes, updatedAttributes);
            logger.info(`Missing attributes before extraction: ${missingAttributes.map(a => a.attribute_key).join(', ')}`);

            const extractedFromMessage = await this.attributeService.extractAttributesFromMessage(content, missingAttributes, lastMessages);
            logger.info(`Extracted attributes from message:`, extractedFromMessage);

            for (const [key, value] of Object.entries(extractedFromMessage)) {
                if (value && value.trim() !== '') {
                    const oldValue = updatedAttributes[key];
                    updatedAttributes[key] = value;
                    attributesUpdated = true;
                    logger.info(`${oldValue ? 'Updated' : 'Extracted new'} attribute ${key}: "${oldValue || 'none'}" -> "${value}"`);
                }
            }

            // Update contact attributes if any new ones were extracted
            if (attributesUpdated) {
                logger.info(`Updating contact with new extracted attributes:`, updatedAttributes);
                await this.attributeService.updateContactAttributes(account_id, contact_id, updatedAttributes, api_access_token);
            }

            // Step 7: Smart attribute collection timing
            logger.info(`=== CHECKING ATTRIBUTE COLLECTION TIMING ===`);
            const currentMissingAttributes = this.attributeService.checkMissingAttributes(requiredAttributes, updatedAttributes);
            const collectionDecision = await this.attributeService.shouldCollectAttributes(lastMessages, currentMissingAttributes);

            logger.info(`Collection decision:`, collectionDecision);

            let finalMissingAttributes = [];
            if (collectionDecision.shouldCollect) {
                finalMissingAttributes = collectionDecision.attributesToCollect || currentMissingAttributes;
                logger.info(`Will collect ${finalMissingAttributes.length} attributes based on timing decision`);
            } else {
                logger.info(`Skipping attribute collection: ${collectionDecision.reason}`);
            }

            // Step 8: Create Langfuse trace
            const trace = await sharedLangfuseService.createTrace(
                account_id.toString(),
                `conversation_${conversationId}`,
                {
                    account_id: account_id,
                    user_message: content,
                    conversation_id: conversationId,
                    account_name: accountName,
                    missing_attributes_count: currentMissingAttributes.length,
                    collecting_attributes_count: finalMissingAttributes.length,
                    current_attributes: updatedAttributes,
                    had_attribute_changes: changeResult.hasChanges,
                    collection_decision: collectionDecision.reason,
                    conversation_turns: collectionDecision.turnCount
                },
                {
                    conversation_id: conversationId,
                    contact_id: contact_id,
                    message_type: webhookData.message_type,
                    channel: req.body?.inbox?.name || "unknown",
                    attributes_collection_phase: finalMissingAttributes.length > 0,
                    attribute_change_detected: changeResult.hasChanges,
                    smart_timing_applied: true
                }
            );

            // Step 9: Generate AI reply
            let tokenUsageFromResponse = null;

            const aiReply = await this.aiService.generateResponse(
                {
                    account_id,
                    account_name: accountName,
                    user_text: content,
                    recent_messages: lastMessages,
                    system_prompt: systemPrompt,
                    contact_attributes: updatedAttributes,
                    missing_attributes: finalMissingAttributes,
                    collection_decision: collectionDecision.reason
                },
                [
                    {
                        handleLLMEnd: async (output) => {
                            tokenUsageFromResponse = output?.llmOutput?.tokenUsage || output?.llmOutput?.usage;
                            if (tokenUsageFromResponse) {
                                logger.info(`[TOKEN] Captured usage - prompt: ${tokenUsageFromResponse.promptTokens}, completion: ${tokenUsageFromResponse.completionTokens}, total: ${tokenUsageFromResponse.totalTokens}`);
                            }
                        }
                    }
                ]
            );

            // Step 10: Handle completion and analytics
            const allAttributesCollected = currentMissingAttributes.length === 0;
            if (allAttributesCollected && Object.keys(updatedAttributes).length > 0) {
                logger.info(`All attributes collected for contact ${contact_id}.`);
            }

            // Calculate cost and update trace
            const finalTokenUsage = {
                promptTokens: tokenUsageFromResponse?.promptTokens || 0,
                completionTokens: tokenUsageFromResponse?.completionTokens || 0,
                totalTokens: tokenUsageFromResponse?.totalTokens || 0
            };

            const costData = this.aiService.calculateCost(finalTokenUsage);

            if (trace) {
                await this.updateLangfuseTrace(trace, aiReply, updatedAttributes, changeResult, collectionDecision, costData, account_id, conversationId);
            }

            logger.info(
                `AI reply with smart attributes (tokens in/out/total ${costData.inputTokens}/${costData.outputTokens}/${costData.totalTokens}) ~ $${costData.costUsd.toFixed(6)}`
            );

            // Step 10.6: Scheduling Detection and Calendar Booking
            logger.info(`=== SCHEDULING DETECTION ===`);
            let schedulingResult = null;
            let skipRegularReply = false; // Flag to control regular AI reply
            let skipLeadClassification = false; // Flag to control lead classification
            
            try {
                // First check if customer is confirming a pending booking
                const pendingBooking = this.bookingConfirmationService.getPendingBooking(conversationId);
                
                if (pendingBooking && pendingBooking.status === 'pending') {
                    logger.info(`Found pending booking for conversation ${conversationId}, checking for confirmation`);
                    
                    const confirmationResult = await this.bookingConfirmationService.detectConfirmation(
                        lastMessages,
                        updatedAttributes
                    );
                    
                    logger.info(`Confirmation detection result:`, confirmationResult);
                    
                    if (confirmationResult.isConfirmation && confirmationResult.confidence >= 0.8) {
                        logger.info(`Customer confirmed booking - proceeding with calendar appointment`);
                        
                        const schedulingDetails = pendingBooking.details;
                        
                        // Book appointment in Google Calendar
                        const bookingResult = await this.googleCalendarService.bookPickupAppointment({
                            ...schedulingDetails,
                            conversationId: conversationId
                        });
                        
                        if (bookingResult.success) {
                            logger.info(`Appointment booked successfully! Event ID: ${bookingResult.eventId}`);
                            const confirmationMessage = `✅ Perfect! I've scheduled your pickup appointment for ${schedulingDetails.pickupDate} at ${schedulingDetails.pickupTime}. You should receive a calendar invitation shortly.`;
                            await this.chatwootService.sendReply(account_id, conversationId, confirmationMessage, CHATWOOT_BOT_TOKEN);
                            
                            // Immediately classify as BOOKED since appointment was successfully created
                            await this.setLeadClassification(account_id, conversationId, api_access_token, 'booked', 1.0, 'Customer successfully booked calendar appointment');
                            
                        } else if (bookingResult.skipped) {
                            logger.info(`Calendar booking skipped - Google Calendar not configured`);
                            const confirmationMessage = `✅ Great! I've confirmed your pickup request for ${schedulingDetails.pickupDate} at ${schedulingDetails.pickupTime}. Our team will contact you to finalize the appointment details.`;
                            await this.chatwootService.sendReply(account_id, conversationId, confirmationMessage, CHATWOOT_BOT_TOKEN);
                            
                            // Classify as BOOKED even without calendar integration
                            await this.setLeadClassification(account_id, conversationId, api_access_token, 'booked', 0.95, 'Customer confirmed pickup appointment');
                            
                        } else {
                            logger.error(`Failed to book appointment:`, bookingResult.error);
                            const errorMessage = `✅ I've confirmed your pickup request for ${schedulingDetails.pickupDate} at ${schedulingDetails.pickupTime}. Our team will contact you shortly to finalize the appointment details.`;
                            await this.chatwootService.sendReply(account_id, conversationId, errorMessage, CHATWOOT_BOT_TOKEN);
                            
                            // Still classify as BOOKED since customer confirmed intent
                            await this.setLeadClassification(account_id, conversationId, api_access_token, 'booked', 0.9, 'Customer confirmed pickup appointment (calendar booking failed)');
                        }
                        
                        // Clear the pending booking
                        this.bookingConfirmationService.clearBooking(conversationId);
                        skipRegularReply = true; // Skip regular AI reply since we sent booking confirmation
                        skipLeadClassification = true; // Skip lead classification since we already set it to "booked"
                        
                    } else if (confirmationResult.isRejection && confirmationResult.confidence >= 0.8) {
                        logger.info(`Customer rejected booking - clearing pending booking`);
                        this.bookingConfirmationService.clearBooking(conversationId);
                        // Let regular AI reply handle the rejection
                        
                    } else {
                        logger.info(`No clear confirmation or rejection detected, keeping booking pending`);
                        // Let regular AI reply handle the response
                    }
                    
                } else {
                    // No pending booking, check for new scheduling intent
                    schedulingResult = await this.schedulingService.detectSchedulingIntent(
                        lastMessages,
                        updatedAttributes
                    );
                    
                    logger.info(`Scheduling detection result:`, schedulingResult);
                    
                    if (schedulingResult.wantsToSchedule && schedulingResult.confidence >= 0.9) {
                        logger.info(`Customer wants to schedule - sending confirmation summary`);
                        
                        const schedulingDetails = this.schedulingService.formatSchedulingDetails(
                            schedulingResult.extractedDetails,
                            updatedAttributes
                        );
                        
                        // Generate booking summary for confirmation
                        const bookingSummary = this.bookingConfirmationService.generateBookingSummary(schedulingDetails);
                        
                        // Set pending confirmation
                        this.bookingConfirmationService.setPendingConfirmation(conversationId, schedulingDetails);
                        
                        // Send confirmation message
                        await this.chatwootService.sendReply(account_id, conversationId, bookingSummary, CHATWOOT_BOT_TOKEN);
                        skipRegularReply = true; // Skip regular AI reply since we sent booking summary
                        
                    } else {
                        logger.info(`No scheduling intent detected or confidence too low (${schedulingResult?.confidence})`);
                    }
                }
            } catch (error) {
                logger.error(`Scheduling detection/booking failed:`, error);
                schedulingResult = null;
            }

            // Step 10.5: Lead Classification (only if not already booked)
            if (!skipLeadClassification) {
                logger.info(`=== LEAD CLASSIFICATION ===`);
                const shouldClassifyLead = await this.shouldClassifyLead(lastMessages, updatedAttributes, currentMissingAttributes);
            
            if (shouldClassifyLead) {
                try {
                    // Skip classification if customer was just marked as booked
                    const pendingBooking = this.bookingConfirmationService.getPendingBooking(conversationId);
                    const wasJustBooked = schedulingResult && schedulingResult.wantsToSchedule && schedulingResult.confidence >= 0.9 && !pendingBooking;
                    
                    if (!wasJustBooked) {
                        const classification = await this.leadClassificationService.classifyLead(
                            lastMessages,
                            updatedAttributes,
                            currentMissingAttributes,
                            false // No direct booking in this flow
                        );
                        
                        logger.info(`Lead classified as: ${classification.category} (score: ${classification.score})`);
                        
                        await this.setLeadClassification(account_id, conversationId, api_access_token, classification.category, classification.score, classification.reasoning);
                    } else {
                        logger.info(`Skipping lead classification - customer was just booked`);
                    }
                } catch (error) {
                    logger.error(`Lead classification failed:`, error);
                }
            } else {
                logger.info(`Skipping lead classification - conversation too early or not enough data`);
            }
            } else {
                logger.info(`Skipping lead classification - customer was just classified as booked`);
            }

            // Step 11: Send reply to Chatwoot (only if not skipped)
            if (!skipRegularReply) {
                await this.chatwootService.sendReply(account_id, conversationId, aiReply, CHATWOOT_BOT_TOKEN);
                logger.info(`Reply sent back to Chatwoot conversation ${conversationId}`);
            }

            // Step 12: Handle follow-up reminders
            await this.handleFollowUpReminder(conversationId, account_id, contact_id, api_access_token, {
                content,
                lastMessages,
                updatedAttributes,
                currentMissingAttributes,
                hasScheduling: schedulingResult?.confidence >= 0.9 || false,
                messageCount: lastMessages.length,
                sender_type: 'contact' // This is a customer message since we're processing it
            });

            res.sendStatus(200);

        } catch (err) {
            logger.error("Webhook processing error:", err);
            if (err.response) {
                logger.error(`API Error (status: ${err.response.status}): ${JSON.stringify(err.response.data)}`);
            } else if (err.request) {
                logger.error("No response received from API: " + err.message);
            } else {
                logger.error("Error: " + err.message);
            }
            res.sendStatus(500);
        }
    }

    async handleFollowUpReminder(conversationId, accountId, contactId, apiToken, messageData) {
        try {
            // Clear any existing reminder since user sent a new message
            this.followUpReminderService.clearReminder(conversationId);

            // Prepare conversation data for reminder decision
            const conversationData = {
                contact: { id: contactId },
                lastMessage: { created_at: new Date() },
                attributes: messageData.updatedAttributes || {},
                hasScheduling: messageData.hasScheduling || false,
                messageCount: messageData.messageCount || 1
            };

            // Enhanced reminder service with actual conversation data
            await this.followUpReminderService.updateConversationData(conversationId, conversationData);

            // Schedule new reminder if appropriate
            const shouldSchedule = this.followUpReminderService.shouldScheduleNewReminder(messageData);
            if (shouldSchedule) {
                this.followUpReminderService.scheduleReminder(conversationId, accountId, contactId, apiToken);
            }

            logger.info(`Follow-up reminder handling completed for conversation ${conversationId}`);
        } catch (error) {
            logger.error(`Error handling follow-up reminder for conversation ${conversationId}:`, error);
        }
    }

    async updateLangfuseTrace(trace, aiReply, updatedAttributes, changeResult, collectionDecision, costData, accountId, conversationId) {
        try {
            await sharedLangfuseService.updateTrace(trace,
                {
                    ai_response: aiReply,
                    success: true,
                    attributes_collected: Object.keys(updatedAttributes).length > 0,
                    final_attributes: updatedAttributes,
                    attribute_changes_processed: changeResult.hasChanges,
                    smart_timing_decision: collectionDecision.reason
                },
                {
                    model: config.MODEL,
                    input_tokens: costData.inputTokens,
                    output_tokens: costData.outputTokens,
                    total_tokens: costData.totalTokens,
                    cost_usd: costData.costUsd,
                    processing_time: Date.now()
                }
            );

            await sharedLangfuseService.logUsage(accountId.toString(), {
                model: config.MODEL,
                input: "webhook_processing",
                output: aiReply,
                endpoint: "chatwoot_webhook_with_smart_attributes",
                tokens_used: costData.totalTokens,
                input_tokens: costData.inputTokens,
                output_tokens: costData.outputTokens,
                cost: costData.costUsd,
                processing_time: Date.now(),
                success: true
            });

            await sharedLangfuseService.logCost(accountId.toString(), {
                transaction_type: "ai_response_with_smart_attribute_management",
                amount: costData.costUsd,
                model: config.MODEL,
                tokens_used: costData.totalTokens,
                conversation_id: conversationId
            });
        } catch (error) {
            logger.error("Error updating Langfuse trace:", error.message);
        }
    }

    /**
     * Determines if lead classification should be performed based on conversation maturity
     * @param {Array} lastMessages - Recent conversation messages
     * @param {Object} currentAttributes - Current contact attributes
     * @param {Array} missingAttributes - Attributes still missing
     * @returns {boolean} Whether to perform lead classification
     */
    async shouldClassifyLead(lastMessages, currentAttributes, missingAttributes) {
        // Don't classify very early conversations (less than 3 exchanges)
        const messageCount = lastMessages.length;
        if (messageCount < 6) { // 6 messages = 3 back-and-forth exchanges
            return false;
        }

        // Always classify if all attributes are collected
        if (missingAttributes.length === 0) {
            return true;
        }

        // Classify if we have meaningful conversation (more than 8 messages)
        if (messageCount >= 8) {
            return true;
        }

        // Classify if conversation shows high engagement patterns
        const customerMessages = lastMessages.filter(msg => msg.message_type === 'incoming');
        if (customerMessages.length >= 4) {
            // Check for engagement indicators
            const hasQuestions = customerMessages.some(msg => 
                msg.content.includes('?') || 
                msg.content.toLowerCase().includes('when') ||
                msg.content.toLowerCase().includes('how') ||
                msg.content.toLowerCase().includes('what')
            );
            
            const hasUrgency = customerMessages.some(msg =>
                msg.content.toLowerCase().includes('urgent') ||
                msg.content.toLowerCase().includes('asap') ||
                msg.content.toLowerCase().includes('quickly') ||
                msg.content.toLowerCase().includes('need') ||
                msg.content.toLowerCase().includes('immediately')
            );

            if (hasQuestions || hasUrgency) {
                return true;
            }
        }

        return false;
    }

    /**
     * Set lead classification and manage tags
     * @param {string} accountId - Account ID
     * @param {string} conversationId - Conversation ID
     * @param {string} apiToken - API access token
     * @param {string} category - Classification category
     * @param {number} score - Classification score
     * @param {string} reasoning - Classification reasoning
     */
    async setLeadClassification(accountId, conversationId, apiToken, category, score, reasoning) {
        try {
            logger.info(`Setting lead classification: ${category} (score: ${score}) - ${reasoning}`);
            
            // Add/update lead classification tag
            await this.chatwootService.addConversationTag(
                accountId, 
                conversationId, 
                category.toLowerCase(), 
                apiToken
            );
            
            // Remove previous lead tags if they exist
            const previousTags = ['hot', 'warm', 'cold', 'rfq', 'booked'];
            for (const tag of previousTags) {
                if (tag.toLowerCase() !== category.toLowerCase()) {
                    await this.chatwootService.removeConversationTag(
                        accountId, 
                        conversationId, 
                        tag, 
                        apiToken
                    );
                }
            }
            
            logger.info(`Lead classification tag ${category.toLowerCase()} added to conversation ${conversationId}`);
        } catch (error) {
            logger.error(`Failed to set lead classification:`, error);
        }
    }
}

export default WebhookController;
