import logger from "../utils/logger.js";
import { Client } from "../model/clientModel.js";
import WebhookValidator from "../middleware/webhookValidator.js";
import ChatwootService from "../services/chatwootService.js";
import AttributeService from "../services/attributeService.js";
import AIService from "../services/aiService.js";
import sharedLangfuseService from "../utils/langfuse.js";
import { config } from "../config/appConfig.js";

class WebhookController {
    constructor() {
        this.chatwootService = new ChatwootService();
        this.attributeService = new AttributeService();
        this.aiService = new AIService();
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

            logger.info(`Webhook received: ${JSON.stringify(req.body, null, 2)}`);
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

            const extractedFromMessage = await this.attributeService.extractAttributesFromMessage(content, requiredAttributes);
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
            const collectionDecision = this.attributeService.shouldCollectAttributes(lastMessages, currentMissingAttributes);

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

            logger.info(`[DEBUG] AI reply generated: "${aiReply}"`);

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

            // Step 11: Send reply to Chatwoot
            await this.chatwootService.sendReply(account_id, conversationId, aiReply, CHATWOOT_BOT_TOKEN);
            logger.info(`Reply sent back to Chatwoot conversation ${conversationId}`);

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
}

export default WebhookController;
