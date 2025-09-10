
import express from "express";
import axios from "axios";
import logger from "./utils/logger.js";
import dotenv from "dotenv";
import mongoConnect from "./config/mongoConnect.js";
import ragRoutes from "./routes/ragRoutes.js";
import enhancedRagRoutes from "./routes/enhancedRagRoutes.js";
import azureUploadRoutes from "./routes/azureUploadRoutes.js";
import azureRagRoutes from "./routes/azureRagRoutes.js";
import multiFileRagRoutes from "./routes/multiFileRagRoutes.js";
import os from "os";
import cors from "cors";

// LangChain / OpenAI
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { Client } from "./model/clientModel.js";

// Langfuse
import sharedLangfuseService from "./utils/langfuse.js";
import CustomAttributeDefinition from "./model/customAttributes.js";
import AttributeExtractor from "./utils/attributeExtraction.js";

const attributeExtractor = new AttributeExtractor(logger);


// RAG Service
import RagService from "./service/ragService1.js";
import { json } from "sequelize";
const RagServices = new RagService();

dotenv.config();

const app = express();
app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

app.use(cors({
    origin: "*", // Or specify your frontend URL for better security
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Initialize RAG service
const ragService = new RagService();

// ---------- Config ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHATWOOT_URL = process.env.CHATWOOT_URL;

// Per-1K token pricing
const PRICING = {
    "gpt-4o-mini": {
        input: Number(process.env.MODEL_PRICING_GPT4O_MINI_INPUT || 0.15),
        output: Number(process.env.MODEL_PRICING_GPT4O_MINI_OUTPUT || 0.60),
    },
};

// ---------- Embeddings ----------
const embeddings = new OpenAIEmbeddings({
    apiKey: OPENAI_API_KEY,
    model: "text-embedding-3-small",
});

// ---------- KB Retriever using RAG Service ----------
async function retrieveKBChunks(accountId, query, topK = 10) {
    try {
        const results = await RagServices.searchDocuments({
            account_id: accountId,
            query,
            limit: topK,
            searchMethod: "hybrid"
        });

        logger.info(`Retrieved ${results.length} KB chunks for account ${accountId} and query "${query}"`);

        // Map the correct keys from searchDocuments
        return results.map(result => ({
            content: result.content,
            document_id: result.document_id,
            source_title: result.source_title,
            source_uri: result.source_uri,
            score: result.score
        }));
    } catch (error) {
        logger.error(`Error retrieving KB chunks for account ${accountId}:`, error.message);
        return [];
    }
}

// ---------- Chatwoot helpers ----------
async function fetchLastMessages(accountId, conversationId, limit = 20, api_access_token) {
    const res = await axios.get(
        `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages?per_page=100`,
        {
            headers: { "Content-Type": "application/json", api_access_token: api_access_token },
            timeout: 10000,
        }
    );
    const all = Array.isArray(res.data) ? res.data : res.data?.payload || [];
    return all.slice(-limit);
}

async function sendChatwootReply(accountId, conversationId, content, CHATWOOT_BOT_TOKEN) {
    await axios.post(
        `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
        { content, message_type: "outgoing" },
        {
            headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_BOT_TOKEN },
            timeout: 10000,
        }
    );
}

// ---------- Contact and Attribute Management ----------
async function getContactAttributes(accountId, inbox_id, contactId, api_access_token) {
    try {
        logger.info(`Fetching contact attributes for contact ${contactId} in inbox ${inbox_id}`);
        const res = await axios.get(
            // https://app.chatwoot.com/public/api/v1/inboxes/{inbox_identifier}/contacts/{contact_identifier}

            `${CHATWOOT_URL}/api/v1/inboxes/${inbox_id}/contacts/${contactId}`,
            {
                headers: { "Content-Type": "application/json", api_access_token: api_access_token },
                timeout: 10000,
            }
        );
        const contact = res.data?.payload || null;
        if (!contact) {
            logger.error(`No contact data found for contact ${contactId}`);
            return {};
        }
        const attributes = contact.custom_attributes || {};
        logger.info(`Fetched contact ${contactId} attributes:`, attributes);
        return attributes;
    } catch (error) {
        logger.error(`Error fetching contact attributes for contact ${contactId}:`, error.message);
        return {};
    }
}

async function updateContactAttributes(accountId, contactId, attributes, api_access_token) {
    try {
        await axios.put(
            `${CHATWOOT_URL}/api/v1/accounts/${accountId}/contacts/${contactId}`,
            { custom_attributes: attributes },
            {
                headers: { "Content-Type": "application/json", api_access_token: api_access_token },
                timeout: 10000,
            }
        );
        logger.info(`Updated contact ${contactId} attributes:`, attributes);
    } catch (error) {
        logger.error(`Error updating contact attributes for contact ${contactId}:`, error.message);
    }
}

// Utility: Extract contact attributes from webhook payload if available
function extractContactAttributesFromWebhook(body) {
    logger.info(`Extracting contact attributes from webhook payload: ${JSON.stringify(body?.conversation?.meta?.sender?.custom_attributes, null, 2)}`);
    return body?.sender?.custom_attributes
        || body?.conversation?.meta?.sender?.custom_attributes
        || (body?.conversation?.messages?.[0]?.sender?.custom_attributes)
        || null;
}

async function getAttributes(accountId) {
    try {
        const client = await Client.findOne({ account_id: accountId, is_active: true });
        if (!client || !client.api_key) {
            logger.error(`[DEBUG] No active client or api_key found for account ${accountId}`);
            return [];
        }
        const ACCESS_TOKEN = client.api_key;
        const { data: defs } = await axios.get(`${process.env.CHATWOOT_URL}/api/v1/accounts/${accountId}/custom_attribute_definitions`, {
            headers: { "Content-Type": "application/json", api_access_token: ACCESS_TOKEN },
            params: { attribute_model: 1 },
            timeout: 10000,
        });
        logger.info(`Fetched ${defs.length} attribute definitions for account ${accountId} full <object data="${JSON.stringify(defs)}" type="application/json"></object>`);
        return defs || [];
    } catch (error) {
        logger.error(`[DEBUG] Error fetching attributes for account ${accountId}:`, error.message);
        return [];
    }
}

// ---------- Custom Regex-Based Attribute Collection Logic ----------

function checkMissingAttributes(requiredAttributes, currentAttributes) {
    const missing = [];
    for (const attr of requiredAttributes) {
        if (!currentAttributes[attr.attribute_key] || currentAttributes[attr.attribute_key] === '') {
            missing.push(attr);
        }
    }
    return missing;
}

// Enhanced extraction function that processes ALL attributes at once
function extractAllAttributesFromMessage(message, requiredAttributes) {
    const extractedAttributes = {};

    if (!message || !requiredAttributes || requiredAttributes.length === 0) {
        return extractedAttributes;
    }

    logger.info(`Attempting to extract attributes from message: "${message}"`);
    logger.info(`Required attributes: ${JSON.stringify(requiredAttributes.map(attr => ({
        key: attr.attribute_key,
        has_regex: !!attr.regex_pattern,
        has_cue: !!attr.regex_cue
    })))}`);

    for (const attribute of requiredAttributes) {
        const extracted = extractAttributeFromMessage(message, attribute);
        if (extracted) {
            extractedAttributes[attribute.attribute_key] = extracted;
            logger.info(`Successfully extracted ${attribute.attribute_key}: ${extracted}`);
        }
    }

    return extractedAttributes;
}

// Dynamic attribute extraction using custom regex patterns from database
function extractAttributeFromMessage(message, attributeDefinition) {
    if (!message || !attributeDefinition) return null;

    const {
        attribute_key,
        attribute_display_name,
        attribute_description,
        regex_pattern,
        regex_cue,
        attribute_values,
        attribute_display_type
    } = attributeDefinition;

    logger.info(`Extracting "${attribute_key}" using ${regex_pattern ? 'custom regex' : 'dynamic patterns'}`);

    let extractedValue = null;

    // Priority 1: Use custom regex pattern if provided
    if (regex_pattern) {
        extractedValue = extractUsingCustomRegex(message, regex_pattern, regex_cue, attribute_key);
        if (extractedValue) {
            logger.info(`Extracted ${attribute_key}: "${extractedValue}" using custom regex pattern`);
            return postProcessExtractedValue(extractedValue, attributeDefinition);
        }
    }

    // Priority 2: Use attribute values for exact matching if provided
    if (attribute_values && attribute_values.length > 0) {
        extractedValue = extractUsingAttributeValues(message, attribute_values, attribute_key);
        if (extractedValue) {
            logger.info(`Extracted ${attribute_key}: "${extractedValue}" using attribute values matching`);
            return postProcessExtractedValue(extractedValue, attributeDefinition);
        }
    }

    // Priority 3: Use dynamic patterns based on attribute metadata
    extractedValue = extractUsingDynamicPatterns(message, attributeDefinition);
    if (extractedValue) {
        logger.info(`Extracted ${attribute_key}: "${extractedValue}" using dynamic patterns`);
        return postProcessExtractedValue(extractedValue, attributeDefinition);
    }

    logger.info(`No extraction found for ${attribute_key}`);
    return null;
}

// Extract using custom regex pattern from database
function extractUsingCustomRegex(message, regexPattern, regexCue, attributeKey) {
    try {
        // If regex_cue is provided, first check if the cue exists in the message
        if (regexCue) {
            const cueRegex = new RegExp(regexCue, 'i');
            if (!cueRegex.test(message)) {
                logger.info(`Regex cue "${regexCue}" not found in message for ${attributeKey}`);
                return null;
            }
            logger.info(`Regex cue "${regexCue}" found, applying custom pattern for ${attributeKey}`);
        }

        // Apply the custom regex pattern
        const customRegex = new RegExp(regexPattern, 'i');
        const match = message.match(customRegex);

        if (match) {
            // Return the first capturing group, or the full match if no groups
            return match[1] || match[0];
        }

        return null;
    } catch (error) {
        logger.error(`Error applying custom regex for ${attributeKey}:`, error.message);
        return null;
    }
}

// Extract using predefined attribute values (for dropdown/select type attributes)
function extractUsingAttributeValues(message, attributeValues, attributeKey) {
    const lowerMessage = message.toLowerCase();

    // Look for exact matches of attribute values in the message
    for (const value of attributeValues) {
        const lowerValue = value.toLowerCase();

        // Direct match
        if (lowerMessage.includes(lowerValue)) {
            return value;
        }

        // Fuzzy matching for slight variations
        const words = lowerValue.split(/\s+/);
        if (words.length > 1 && words.every(word => lowerMessage.includes(word))) {
            return value;
        }
    }

    return null;
}

// Fallback dynamic patterns when no custom regex is provided
function extractUsingDynamicPatterns(message, attributeDefinition) {
    const {
        attribute_key,
        attribute_display_name,
        attribute_description
    } = attributeDefinition;

    const lowerMessage = message.toLowerCase();
    const lowerAttributeKey = attribute_key.toLowerCase();
    const lowerDisplayName = (attribute_display_name || attribute_key).toLowerCase();

    // Generate fallback patterns
    const patterns = [
        // Direct attribute key patterns
        {
            regex: new RegExp(`(?:${lowerAttributeKey})(?:\\s*is|\\s*:|\\s+)\\s*([a-zA-Z0-9\\s&.-]+)`, 'i'),
            description: 'Attribute key with separator'
        },
        {
            regex: new RegExp(`(?:my\\s+${lowerAttributeKey})(?:\\s*is|\\s*:|\\s+)\\s*([a-zA-Z0-9\\s&.-]+)`, 'i'),
            description: 'My + attribute key'
        },

        // Display name patterns
        {
            regex: new RegExp(`(?:${lowerDisplayName})(?:\\s*is|\\s*:|\\s+)\\s*([a-zA-Z0-9\\s&.-]+)`, 'i'),
            description: 'Display name with separator'
        },

        // Context-aware patterns based on description
        ...generateDescriptionPatterns(attribute_description),

        // Generic contextual patterns
        {
            regex: new RegExp(`${lowerAttributeKey}[\\s:]+([^\\n\\r.,;!?]+)`, 'i'),
            description: 'Direct key context'
        }
    ];

    // Try each pattern
    for (const pattern of patterns) {
        try {
            const match = message.match(pattern.regex);
            if (match && match[1] && match[1].trim()) {
                logger.info(`Matched using fallback pattern: ${pattern.description}`);
                return match[1].trim();
            }
        } catch (error) {
            logger.warn(`Pattern error: ${error.message}`);
            continue;
        }
    }

    return null;
}

// Generate patterns from attribute description
function generateDescriptionPatterns(description) {
    const patterns = [];

    if (!description) return patterns;

    // Extract keywords from description (words longer than 3 characters)
    const keywords = description.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3 && !isStopWord(word));

    // Create patterns from description keywords
    for (const keyword of keywords) {
        patterns.push({
            regex: new RegExp(`(?:${keyword})(?:\\s*is|\\s*:|\\s+)\\s*([a-zA-Z0-9\\s&.-]+)`, 'i'),
            description: `Description keyword: ${keyword}`
        });
    }

    return patterns;
}

// Helper function to check stop words
function isStopWord(word) {
    const stopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over', 'after'];
    return stopWords.includes(word.toLowerCase());
}

// Enhanced post-processing with attribute definition context
function postProcessExtractedValue(value, attributeDefinition) {
    if (!value) return null;

    value = value.trim();

    const {
        attribute_key,
        attribute_values,
        attribute_display_type,
        attribute_description
    } = attributeDefinition;

    // If we have predefined values, try to match to closest one
    if (attribute_values && attribute_values.length > 0) {
        const matchedValue = findClosestAttributeValue(value, attribute_values);
        if (matchedValue) {
            return matchedValue;
        }
    }

    // Special handling for specific attribute types based on description
    if (attribute_description) {
        const lowerDescription = attribute_description.toLowerCase();

        // Location handling
        if (lowerDescription.includes('location') || lowerDescription.includes('address')) {
            return cleanLocationValue(value);
        }

        // Classification handling (Hot, Warm, Cold example)
        if (lowerDescription.includes('classification') || lowerDescription.includes('can be one of')) {
            return cleanClassificationValue(value, attribute_description);
        }
    }

    // Generic text cleanup - just trim and clean basic formatting
    return value.replace(/\s+/g, ' ').trim();
}

// Find closest matching value from predefined attribute values
function findClosestAttributeValue(extractedValue, attributeValues) {
    const lowerExtracted = extractedValue.toLowerCase();

    // Exact match
    for (const value of attributeValues) {
        if (value.toLowerCase() === lowerExtracted) {
            return value;
        }
    }

    // Partial match
    for (const value of attributeValues) {
        if (lowerExtracted.includes(value.toLowerCase()) || value.toLowerCase().includes(lowerExtracted)) {
            return value;
        }
    }

    return null;
}

// Specialized cleaning functions for your actual use cases
function cleanLocationValue(value) {
    // Remove common location prefixes/suffixes
    return value.replace(/^(at|in|from|location:?)\s+/i, '')
        .replace(/\s+(area|location|place)$/i, '')
        .trim();
}

function cleanClassificationValue(value, description) {
    // Extract possible values from description like "Hot, Warm, Cold"
    const possibleValues = extractPossibleValuesFromDescription(description);

    if (possibleValues.length > 0) {
        return findClosestAttributeValue(value, possibleValues);
    }

    return value;
}

function extractPossibleValuesFromDescription(description) {
    // Look for patterns like "Can be one of these 3 values - Hot, Warm, Cold"
    const matches = description.match(/(?:can be|values?)[^-]*-\s*([^.]+)/i);
    if (matches) {
        return matches[1].split(',').map(v => v.trim());
    }

    return [];
}

function shouldIgnoreMessage({ req, logger }) {
    const { content, sender, message_type } = req.body;
    const messageSenderType = req.body.conversation?.messages?.[0]?.sender_type;
    if (messageSenderType === "AgentBot" || messageSenderType === "Agent") {
        logger.info(`Ignoring message from bot/agent. Sender type: ${messageSenderType}`);
        return true;
    }
    if (messageSenderType && messageSenderType !== "Contact") {
        logger.info(`Ignoring non-contact message. Sender type: ${messageSenderType}`);
        return true;
    }
    if (sender?.type && sender.type !== "contact") {
        logger.info(`Ignoring non-contact message. Top-level sender type: ${sender?.type}`);
        return true;
    }
    if (message_type && message_type !== "incoming") {
        logger.info(`Ignoring ${message_type} message`);
        return true;
    }
    if (!content || String(content).trim() === "") {
        logger.info(`Ignoring empty message`);
        return true;
    }
    return false;
}

// ---------- LLM + Prompt ----------
const MODEL = "gpt-4o-mini";

// Enhanced prompt that handles attribute collection
// Replace your existing prompt with this enhanced version

const prompt = ChatPromptTemplate.fromMessages([
    [
        "system",
        `You are the AI Support Agent for {account_name}.

{system_prompt}

IMPORTANT INSTRUCTIONS:
1. ATTRIBUTE COLLECTION: If missing_attributes is provided and not empty, you MUST ask for those attributes before proceeding with the main query.
2. ATTRIBUTE CHANGES: Any attribute changes have already been processed. If mentioned in the conversation, acknowledge them naturally.
3. Ask for missing attributes in a conversational, natural way - only ONE at a time.
4. After collecting an attribute, acknowledge it and proceed to help with their query or ask for the next missing attribute.
5. Always ground your answers in the context below (knowledge base and conversation history).
6. If the answer is not in the context, ask clarifying questions or suggest escalation.
8. Never make up information or speculate.
9. Greet the user by name if you know it.
10. Be natural and conversational - avoid sounding robotic or overly formal.

ATTRIBUTE STATUS:
- Missing attributes that need collection: {missing_attributes}
- Currently collected attributes: {current_attributes}

CONVERSATION CONTEXT:
The user may have just updated some information. Handle this naturally in your response.
`,
    ],
    [
        "human",
        `User message: {user}

Recent conversation (most recent last):
{recent_transcript}

Knowledge snippets:
{kb}

Instructions:
- If there are missing_attributes, prioritize collecting them before answering the main query
- Be conversational and natural when asking for missing information
- Ground your answer in the provided context
- Greet the user appropriately if this seems like a new conversation
- If multiple policies conflict, ask clarifying questions
- Handle any information updates naturally without being repetitive`,
    ],
]);

const llm = new ChatOpenAI({
    apiKey: OPENAI_API_KEY,
    model: MODEL,
    temperature: 0.4,
});

const chain = RunnableSequence.from([
    async (input) => {
        const {
            account_id,
            account_name,
            user_text,
            recent_messages,
            system_prompt,
            contact_attributes,
            missing_attributes
        } = input;

        // Build readable transcript from last messages (skip private notes)
        const transcript = (recent_messages || [])
            .filter((m) => !m.private)
            .map((m) => {
                const who = m.message_type === "incoming" ? "Customer" : (m.sender?.type || "Agent").toString();
                const text = (m.content || "").replace(/\s+/g, " ").trim();
                return `${who}: ${text}`;
            })
            .join("\n");

        // Retrieve KB chunks (per tenant)
        const hits = await retrieveKBChunks(account_id, user_text, 10);
        const kbBlock = (hits || [])
            .map((h) => `• ${String(h.content || "").trim()} [${h.source_title || "KB"}]`)
            .join("\n");

        // Format missing attributes for the prompt
        const missingAttrText = (missing_attributes || [])
            .map(attr => `- ${attr.attribute_display_name || attr.attribute_key} (${attr.attribute_description || 'Required field'})`)
            .join("\n");

        // Format current attributes
        const currentAttrText = Object.entries(contact_attributes || {})
            .map(([key, value]) => `- ${key}: ${value}`)
            .join("\n");

        return {
            account_id,
            account_name,
            user: user_text,
            recent_transcript: transcript,
            kb: kbBlock || "No KB snippets available.",
            system_prompt: system_prompt || "",
            missing_attributes: missingAttrText || "None",
            current_attributes: currentAttrText || "None collected yet",
        };
    },
    prompt,
    llm,
    new StringOutputParser(),
]);

// Mount RAG routes
app.use("/api/rag", ragRoutes);
app.use("/api/rag-enhanced", enhancedRagRoutes);
app.use("/api/azure", azureUploadRoutes);
app.use("/api/azure-rag", azureRagRoutes);
app.use("/api/multi-rag", multiFileRagRoutes);

// ---------- Enhanced Webhook with Attribute Collection ----------
// ---------- Enhanced Webhook with Attribute Collection ----------
app.post("/chatwoot-webhook", async (req, res) => {
    const { content, conversation, message_type } = req.body;
    const account_id = req.body.account?.id;
    const contact_id = req.body.conversation?.contact_inbox?.contact_id;

    // Loop prevention - same as before
    const loopPreventionResult = shouldIgnoreMessage({ req, logger });
    if (loopPreventionResult) return res.sendStatus(200);
    
    logger.info(`Webhook received: ${JSON.stringify(req.body, null, 2)}`);
    logger.info(`Account ID: ${account_id}, Contact ID: ${contact_id}`);

    const conversationId = conversation?.id;
    const accountName = req.body.account?.name || `Account ${account_id}`;

    try {
        const client = await Client.findOne({ account_id: account_id, is_active: true });
        if (!client) {
            logger.info(`No active client found for account_id ${account_id}. Skipping AI response.`);
            return res.sendStatus(200);
        }

        const CHATWOOT_BOT_TOKEN = client?.bot_api_key;
        const api_access_token = client?.api_key;
        const systemPrompt = client?.system_prompt || null;

        if (!CHATWOOT_BOT_TOKEN || !api_access_token) {
            logger.warn(`Missing API keys for account_id ${account_id}. Cannot proceed.`);
            return res.sendStatus(200);
        }

        // Get required attributes for this account
        const requiredAttributes = await getAttributes(account_id);
        logger.info(`Found ${requiredAttributes.length} required attributes for account ${account_id}`);

        // Get current contact attributes
        let currentContactAttributes = extractContactAttributesFromWebhook(req.body);
        if (currentContactAttributes && typeof currentContactAttributes === 'object') {
            logger.info(`Current contact attributes (from webhook):`, currentContactAttributes);
        } else {
            currentContactAttributes = await getContactAttributes(account_id, req.body?.inbox?.id, contact_id, api_access_token);
            logger.info(`Current contact attributes (from API):`, currentContactAttributes);
        }

        // Get conversation history for smart timing
        const lastMessages = await fetchLastMessages(account_id, conversationId, 20, api_access_token);
        logger.info(`Fetched ${lastMessages.length} recent messages for context.`);

        // STEP 1: Check for attribute change intent FIRST
        logger.info(`=== CHECKING FOR ATTRIBUTE CHANGES ===`);
        
        const changeResult = await attributeExtractor.processAttributeChanges(
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
                // Attribute was successfully changed
                logger.info(`Attribute successfully changed:`, changeResult.changeDetails);
                const confirmationMessage = changeResult.confirmationMessage;
                
                await sendChatwootReply(account_id, conversationId, confirmationMessage, CHATWOOT_BOT_TOKEN);
                return res.sendStatus(200);
                
            } else if (changeResult.needsValue) {
                // Need the user to provide the new value
                logger.info(`Attribute change request detected, asking for new value`);
                await sendChatwootReply(account_id, conversationId, changeResult.clarificationQuestion, CHATWOOT_BOT_TOKEN);
                return res.sendStatus(200);
                
            } else if (changeResult.needsConfirmation) {
                // Need confirmation from user
                logger.info(`Attribute change needs confirmation`);
                await sendChatwootReply(account_id, conversationId, changeResult.clarificationQuestion, CHATWOOT_BOT_TOKEN);
                return res.sendStatus(200);
                
            } else {
                // Change failed - continue with normal flow but note the error
                logger.error(`Attribute change failed:`, changeResult.error);
            }
        }

        // STEP 2: Extract new attributes from message (if any)
        logger.info(`=== EXTRACTING NEW ATTRIBUTES ===`);
        
        let updatedAttributes = { ...currentContactAttributes };
        let attributesUpdated = false;
        const extractedFromMessage = await attributeExtractor.extractAllAttributesFromMessage(content, requiredAttributes);

        for (const [key, value] of Object.entries(extractedFromMessage)) {
            if (!updatedAttributes[key] && value) {
                updatedAttributes[key] = value;
                attributesUpdated = true;
                logger.info(`Extracted new attribute ${key}: ${value}`);
            }
        }

        // Update contact attributes if any new ones were extracted
        if (attributesUpdated) {
            logger.info(`Updating contact with new extracted attributes: ${JSON.stringify(updatedAttributes)}`);
            await updateContactAttributes(account_id, contact_id, updatedAttributes, api_access_token);
        }

        // STEP 3: Smart attribute collection timing
        logger.info(`=== CHECKING ATTRIBUTE COLLECTION TIMING ===`);
        
        const missingAttributes = checkMissingAttributes(requiredAttributes, updatedAttributes);
        const collectionDecision = attributeExtractor.shouldCollectAttributes(lastMessages, missingAttributes);
        
        logger.info(`Collection decision:`, collectionDecision);
        
        let finalMissingAttributes = [];
        
        if (collectionDecision.shouldCollect) {
            finalMissingAttributes = collectionDecision.attributesToCollect || missingAttributes;
            logger.info(`Will collect ${finalMissingAttributes.length} attributes based on timing decision`);
        } else {
            logger.info(`Skipping attribute collection: ${collectionDecision.reason}`);
            // Don't ask for attributes, but continue with normal conversation
        }

        // Create Langfuse trace
        const trace = await sharedLangfuseService.createTrace(
            account_id.toString(),
            `conversation_${conversationId}`,
            {
                account_id: account_id,
                user_message: content,
                conversation_id: conversationId,
                account_name: accountName,
                missing_attributes_count: missingAttributes.length,
                collecting_attributes_count: finalMissingAttributes.length,
                current_attributes: updatedAttributes,
                had_attribute_changes: changeResult.hasChanges,
                collection_decision: collectionDecision.reason,
                conversation_turns: collectionDecision.turnCount
            },
            {
                conversation_id: conversationId,
                contact_id: contact_id,
                message_type: message_type,
                channel: req.body?.inbox?.name || "unknown",
                attributes_collection_phase: finalMissingAttributes.length > 0,
                attribute_change_detected: changeResult.hasChanges,
                smart_timing_applied: true
            }
        );

        let tokenUsageFromResponse = null;

        // Generate AI reply with smart attribute handling
        const aiReply = await chain.invoke(
            {
                account_id,
                account_name: accountName,
                user_text: content,
                recent_messages: lastMessages,
                system_prompt: systemPrompt,
                contact_attributes: updatedAttributes,
                missing_attributes: finalMissingAttributes, // Only pass attributes we want to collect
                collection_decision: collectionDecision.reason
            },
            {
                callbacks: [
                    {
                        handleLLMEnd: async (output) => {
                            tokenUsageFromResponse = output?.llmOutput?.tokenUsage || output?.llmOutput?.usage;
                            if (tokenUsageFromResponse) {
                                logger.info(`[TOKEN] Captured usage - prompt: ${tokenUsageFromResponse.promptTokens}, completion: ${tokenUsageFromResponse.completionTokens}, total: ${tokenUsageFromResponse.totalTokens}`);
                            }
                        }
                    }
                ],
                runName: "wiral-rag-reply-with-smart-attributes",
                tags: [
                    `account:${account_id}`,
                    `conversation:${conversationId}`,
                    `attributes:${finalMissingAttributes.length}`,
                    `changes:${changeResult.hasChanges ? 'yes' : 'no'}`,
                    `timing:${collectionDecision.reason}`
                ],
                metadata: {
                    account_id,
                    conversation_id: conversationId,
                    contact_id,
                    attributes_collected: Object.keys(updatedAttributes).length,
                    attributes_missing: missingAttributes.length,
                    attributes_collecting: finalMissingAttributes.length,
                    attribute_changes: changeResult.hasChanges,
                    collection_timing: collectionDecision.reason,
                    conversation_turns: collectionDecision.turnCount
                },
            }
        );

        logger.info(`[DEBUG] AI reply generated: "${aiReply}"`);

        // Check if all attributes are collected
        const allAttributesCollected = missingAttributes.length === 0;
        if (allAttributesCollected && Object.keys(updatedAttributes).length > 0) {
            logger.info(`All attributes collected for contact ${contact_id}.`);
            // Here you can call your external API if needed
            // await callExternalAPI(account_id, { contact_id, conversation_id: conversationId, attributes: updatedAttributes }, updatedAttributes);
        }

        // Calculate cost and update trace
        const finalTokenUsage = {
            promptTokens: tokenUsageFromResponse?.promptTokens || 0,
            completionTokens: tokenUsageFromResponse?.completionTokens || 0,
            totalTokens: tokenUsageFromResponse?.totalTokens || 0
        };

        const modelPricing = PRICING[MODEL] || { input: 0, output: 0 };
        const inputTokens = finalTokenUsage.promptTokens;
        const outputTokens = finalTokenUsage.completionTokens;
        const costUsd = (inputTokens / 1000) * modelPricing.input + (outputTokens / 1000) * modelPricing.output;

        // Update trace
        if (trace) {
            await sharedLangfuseService.updateTrace(trace,
                {
                    ai_response: aiReply,
                    success: true,
                    attributes_collected: allAttributesCollected,
                    final_attributes: updatedAttributes,
                    attribute_changes_processed: changeResult.hasChanges,
                    smart_timing_decision: collectionDecision.reason
                },
                {
                    model: MODEL,
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    total_tokens: finalTokenUsage.totalTokens,
                    cost_usd: costUsd,
                    processing_time: Date.now()
                }
            );

            // Log usage
            await sharedLangfuseService.logUsage(account_id.toString(), {
                model: MODEL,
                input: content,
                output: aiReply,
                endpoint: "chatwoot_webhook_with_smart_attributes",
                tokens_used: finalTokenUsage.totalTokens,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cost: costUsd,
                processing_time: Date.now(),
                success: true
            });

            await sharedLangfuseService.logCost(account_id.toString(), {
                transaction_type: "ai_response_with_smart_attribute_management",
                amount: costUsd,
                model: MODEL,
                tokens_used: finalTokenUsage.totalTokens,
                conversation_id: conversationId
            });
        }

        logger.info(
            `AI reply with smart attributes (tokens in/out/total ${inputTokens}/${outputTokens}/${finalTokenUsage.totalTokens}) ~ $${costUsd.toFixed(6)}`
        );

        // Send reply to Chatwoot
        await sendChatwootReply(account_id, conversationId, aiReply, CHATWOOT_BOT_TOKEN);
        logger.info(`Reply sent back to Chatwoot conversation ${conversationId}`);

        res.sendStatus(200);
    } catch (err) {
        if (err.response) {
            logger.error(`API Error (status: ${err.response.status}): ${JSON.stringify(err.response.data)}`);
        } else if (err.request) {
            logger.error("No response received from API: " + err.message);
        } else {
            logger.error("Error: " + err.message);
        }
        res.sendStatus(500);
    }
});

// Health check endpoint
app.get("/health", async (req, res) => {
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
});

// Analytics endpoint for account usage
app.get("/api/analytics/:accountId", async (req, res) => {
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
});

// New endpoint to manually test external API
app.post("/api/test-external-api", async (req, res) => {
    try {
        const { accountId, contactData, attributes } = req.body;
        // contactData should be contactId (string or number), not an object
        const contactId = typeof contactData === 'object' && contactData.contact_id ? contactData.contact_id : contactData;
        const result = await updateContactAttributes(accountId, contactId, attributes, req.body.api_access_token);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        logger.error(`Error testing external API:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ---------- Boot ----------
async function start() {
    try {
        console.log("Starting server...");

        // Connect to MongoDB
        await mongoConnect();

        // Initialize Langfuse service
        await sharedLangfuseService.initialize();

        app.listen(3009, () => {
            logger.info("Enhanced AI Bot with RAG service and Smart Attribute Collection running on port 3009");
            logger.info("Environment check:");
            logger.info(`- CHATWOOT_URL: ${process.env.CHATWOOT_URL ? "Set" : "Missing"}`);
            logger.info(`- OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "Set" : "Missing"}`);
            logger.info(`- MONGODB_URI: ${process.env.MONGODB_URI ? "Set" : "Missing"}`);
            logger.info(`- LANGFUSE_ENABLED: ${process.env.LANGFUSE_ENABLED ? "Set" : "Missing"}`);
            logger.info(`- LANGFUSE_BASE_URL: ${process.env.LANGFUSE_BASE_URL ? "Set" : "Missing"}`);
            logger.info(`- LANGFUSE_PUBLIC_KEY: ${process.env.LANGFUSE_PUBLIC_KEY ? "Set" : "Missing"}`);
            logger.info(`- LANGFUSE_SECRET_KEY: ${process.env.LANGFUSE_SECRET_KEY ? "Set" : "Missing"}`);
            logger.info("MongoDB connection: Enabled");
            logger.info("Features: RAG, Smart Attribute Collection, Dynamic Client Support, Professional Timing");
        });
    } catch (e) {
        logger.error("Failed to start server: " + e.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await sharedLangfuseService.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await sharedLangfuseService.shutdown();
    process.exit(0);
});

start();