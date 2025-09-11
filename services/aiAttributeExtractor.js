import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import logger from "../utils/logger.js";
import { config } from "../config/appConfig.js";

class AIAttributeExtractor {
    constructor() {
        this.llm = new ChatOpenAI({
            apiKey: config.OPENAI_API_KEY,
            model: "gpt-4o-mini",
            temperature: 0.1,
        });

        this.initializeChains();
    }

    initializeChains() {
        // Chain for detecting attribute change intent
        this.changeDetectionPrompt = ChatPromptTemplate.fromMessages([
            [
                "system",
                `You are an expert at detecting when users want to CHANGE or UPDATE their EXISTING information.

CRITICAL: Only detect change intent when users explicitly use words like "change", "update", "modify", "correct", "fix", or "actually" followed by a different value.

Examples of CLEAR CHANGE intent:
- "I want to change my destination to London"
- "Update my phone number to 12345"
- "Can you modify my address?"
- "Actually, make that Dubai instead of Mumbai"
- "Correct the origin to Chennai"
- "Change that to air freight"

Examples of NO CHANGE intent (providing new information):
- "I need to send a package" (initial request)
- "My name is John" (providing info for first time)
- "Origin Chennai, Destination Dubai" (giving details)
- "Air freight service" (specifying service type)
- "It'll be Doha, Qatar" (providing destination info)
- "The package is 5kg" (providing cargo details)

Current attributes the user has: {current_attributes}
Available attribute definitions: {attribute_definitions}

If current_attributes is empty or the attribute being mentioned is not in current_attributes, this is NOT a change - it's new information.

Respond in JSON format with these exact fields:
{{
  "has_change_intent": true/false,
  "attribute_key": "exact_key_name_or_null",
  "new_value": "extracted_value_or_null", 
  "needs_clarification": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "your_explanation_here"
}}`
            ],
            [
                "human",
                `User message: "{message}"

Does this message show explicit intent to CHANGE existing information?`
            ]
        ]);

        this.changeDetectionChain = RunnableSequence.from([
            this.changeDetectionPrompt,
            this.llm,
            new StringOutputParser(),
        ]);

        // Chain for extracting attributes from messages
        this.extractionPrompt = ChatPromptTemplate.fromMessages([
            [
                "system",
                `You are an expert at extracting specific attribute values from user messages.

Extract ONLY the following attributes from the user's message:
{attribute_definitions}

Rules:
1. Only extract values that are explicitly mentioned or clearly implied
2. Do not make assumptions or guess values
3. Extract the most relevant and accurate value for each attribute
4. If multiple values are provided for the same attribute, use the most specific one
5. Normalize values appropriately (e.g., clean up addresses, phone numbers)
6. Only return attributes that you found specific values for

IMPORTANT PATTERNS TO RECOGNIZE:
- Numbers (like 123456, 3434343) could be contact numbers if that attribute is missing
- Location names (cities, countries) are origins or destinations

Current conversation context: {conversation_context}

Available attributes to extract (use these exact keys):
{available_attribute_keys}

Respond in JSON format with only the attributes you found. Use the exact attribute keys provided above.
Example format (only include attributes you actually found):
{{
  "attribute_key_1": "extracted_value_1",
  "attribute_key_2": "extracted_value_2"
}}

If no specific attributes are found, return an empty object: {{}}`
            ],
            [
                "human",
                `User message: "{message}"

Extract any specific attribute values using the exact attribute keys provided. Pay attention to patterns like numbers for contact info, service names, locations, etc.`
            ]
        ]);

        this.extractionChain = RunnableSequence.from([
            this.extractionPrompt,
            this.llm,
            new StringOutputParser(),
        ]);

        // Chain for smart collection timing
        this.timingPrompt = ChatPromptTemplate.fromMessages([
            [
                "system",
                `You are an expert at determining the right time to collect information from users during conversations.

Analyze the conversation flow and determine:
1. Is the user asking questions or providing information?
2. Are they in the middle of an urgent request?
3. Would asking for attributes interrupt their flow?
4. What's the conversation sentiment and urgency?

Missing attributes: {missing_attributes}
Current conversation turn count: {turn_count}

Guidelines:
- If user just provided one piece of info, they're likely ready to provide more
- If they're asking urgent questions, delay collection
- If conversation is new (<=3 turns), prioritize collection
- If user is already in a providing mode, continue collecting
- If user says they don't know something (like "idk", "not sure", "don't know"), don't insist on collection
- Collect remaining attributes efficiently (ask for multiple if only 2-3 remain)
- If user seems hesitant or unsure about an attribute, mark it as lower priority

Recent conversation: {recent_messages}

Respond in JSON format with these exact fields:
{{
  "should_collect": true/false,
  "reason": "your_explanation_here",
  "urgency_level": "low/medium/high",
  "user_mode": "asking/providing/chatting/urgent",
  "best_timing": "now/after_response/later"
}}`
            ],
            [
                "human",
                `Current user message: "{current_message}"

Should we collect missing attributes now?`
            ]
        ]);

        this.timingChain = RunnableSequence.from([
            this.timingPrompt,
            this.llm,
            new StringOutputParser(),
        ]);
    }

    async detectAttributeChangeIntent(message, currentAttributes, requiredAttributes) {
        try {
            logger.info(`=== AI CHANGE DETECTION ===`);
            logger.info(`Message: "${message}"`);

            const attributeDefsText = requiredAttributes.map(attr => 
                `- ${attr.attribute_key}: ${attr.attribute_display_name} (${attr.attribute_description || 'No description'})`
            ).join('\n');

            const currentAttrsText = Object.entries(currentAttributes).map(([key, value]) => 
                `${key}: ${value}`
            ).join(', ') || 'None';

            const response = await this.changeDetectionChain.invoke({
                message,
                current_attributes: currentAttrsText,
                attribute_definitions: attributeDefsText
            });

            // Clean response if it has markdown formatting
            const cleanedResponse = response.replace(/```json\s*|\s*```/g, '').trim();
            const result = JSON.parse(cleanedResponse);
            logger.info(`AI Change Detection Result:`, result);

            return {
                hasChangeIntent: result.has_change_intent,
                changeType: result.has_change_intent ? 'ai_detected' : null,
                attributeKey: result.attribute_key,
                newValue: result.new_value,
                confidence: result.confidence,
                needsValue: result.has_change_intent && !result.new_value,
                needsConfirmation: result.needs_clarification,
                reasoning: result.reasoning
            };

        } catch (error) {
            logger.error(`Error in AI change detection:`, error);
            return {
                hasChangeIntent: false,
                changeType: null,
                attributeKey: null,
                newValue: null,
                confidence: 0,
                needsValue: false,
                error: error.message
            };
        }
    }

    async extractAllAttributesFromMessage(message, requiredAttributes, conversationContext = []) {
        try {
            logger.info(`=== AI ATTRIBUTE EXTRACTION ===`);
            logger.info(`Message: "${message}"`);

            const attributeDefsText = requiredAttributes.map(attr => 
                `- ${attr.attribute_key} (${attr.attribute_display_name}): ${attr.attribute_description || 'No description'}`
            ).join('\n');

            const availableKeys = requiredAttributes.map(attr => attr.attribute_key).join(', ');

            const contextText = conversationContext.slice(-5).map(msg => 
                `${msg.message_type === 'incoming' ? 'User' : 'Agent'}: ${msg.content}`
            ).join('\n') || 'No previous context';

            const response = await this.extractionChain.invoke({
                message,
                attribute_definitions: attributeDefsText,
                available_attribute_keys: availableKeys,
                conversation_context: contextText
            });

            // Clean response if it has markdown formatting
            const cleanedResponse = this.cleanJsonResponse(response);
            const extractedAttributes = JSON.parse(cleanedResponse);
            logger.info(`AI Extracted attributes:`, extractedAttributes);

            // Validate extracted attributes against required attributes
            const validatedAttributes = {};
            for (const [key, value] of Object.entries(extractedAttributes)) {
                const attrDef = requiredAttributes.find(attr => attr.attribute_key === key);
                if (attrDef && value && value.trim() !== '') {
                    // Apply any validation or normalization based on attribute type
                    validatedAttributes[key] = this.normalizeAttributeValue(value, attrDef);
                }
            }

            return validatedAttributes;

        } catch (error) {
            logger.error(`Error in AI attribute extraction:`, error);
            return {};
        }
    }

    async shouldCollectAttributes(recentMessages, missingAttributes) {
        try {
            logger.info(`=== AI TIMING ANALYSIS ===`);

            if (!missingAttributes || missingAttributes.length === 0) {
                return {
                    shouldCollect: false,
                    reason: 'no_missing_attributes',
                    attributesToCollect: [],
                    turnCount: recentMessages.length
                };
            }

            const currentMessage = recentMessages[recentMessages.length - 1];
            const recentMessagesText = recentMessages.slice(-5).map(msg => 
                `${msg.message_type === 'incoming' ? 'User' : 'Agent'}: ${msg.content || ''}`
            ).join('\n');

            const missingAttrsText = missingAttributes.map(attr => 
                `${attr.attribute_key}: ${attr.attribute_display_name}`
            ).join(', ');

            const response = await this.timingChain.invoke({
                current_message: currentMessage?.content || '',
                recent_messages: recentMessagesText,
                missing_attributes: missingAttrsText,
                turn_count: recentMessages.length
            });

            // Clean response if it has markdown formatting
            const cleanedResponse = response.replace(/```json\s*|\s*```/g, '').trim();
            const result = JSON.parse(cleanedResponse);
            logger.info(`AI Timing Analysis Result:`, result);

            return {
                shouldCollect: result.should_collect && result.best_timing === 'now',
                reason: result.reason,
                urgencyLevel: result.urgency_level,
                userMode: result.user_mode,
                bestTiming: result.best_timing,
                attributesToCollect: result.should_collect ? 
                    (missingAttributes.length <= 2 ? missingAttributes : missingAttributes.slice(0, 2)) : [], // Collect up to 2 at a time when few remain
                turnCount: recentMessages.length
            };

        } catch (error) {
            logger.error(`Error in AI timing analysis:`, error);
            return {
                shouldCollect: false,
                reason: 'ai_timing_error',
                attributesToCollect: [],
                turnCount: recentMessages.length,
                error: error.message
            };
        }
    }

    normalizeAttributeValue(value, attributeDefinition) {
        if (!value || typeof value !== 'string') return value;

        const cleanValue = value.trim();
        const attrKey = attributeDefinition.attribute_key.toLowerCase();
        const description = (attributeDefinition.attribute_description || '').toLowerCase();

        // Apply basic normalization based on attribute type
        if (attrKey.includes('phone') || description.includes('phone')) {
            // Basic phone number cleaning
            return cleanValue.replace(/[^\d+\-\s()]/g, '').trim();
        }

        if (attrKey.includes('email') || description.includes('email')) {
            // Basic email cleaning
            return cleanValue.toLowerCase();
        }

        if (attrKey.includes('location') || attrKey.includes('address') || description.includes('address')) {
            // Basic address cleaning
            return cleanValue.replace(/\s+/g, ' ').trim();
        }

        // For attributes with predefined values, try to match
        if (attributeDefinition.attribute_values && attributeDefinition.attribute_values.length > 0) {
            const lowerValue = cleanValue.toLowerCase();
            const match = attributeDefinition.attribute_values.find(val => 
                val.toLowerCase() === lowerValue || 
                val.toLowerCase().includes(lowerValue) ||
                lowerValue.includes(val.toLowerCase())
            );
            return match || cleanValue;
        }

        return cleanValue;
    }

    // Legacy compatibility methods (simplified)
    containsQuestionWords(message) {
        const questionWords = ['what', 'where', 'when', 'who', 'why', 'how', 'which', 'can', 'could', 'would', 'will', 'do', 'does', 'did', 'is', 'are', 'was', 'were'];
        const lowerMessage = message.toLowerCase();
        return questionWords.some(word => lowerMessage.includes(word)) || message.includes('?');
    }

    isConversationalStatement(message) {
        const conversationalIndicators = [
            'i think', 'i believe', 'i feel', 'i guess', 'maybe', 'perhaps', 'probably',
            'by the way', 'anyway', 'also', 'actually', 'basically', 'honestly'
        ];
        const lowerMessage = message.toLowerCase();
        return conversationalIndicators.some(indicator => lowerMessage.includes(indicator));
    }

    cleanJsonResponse(response) {
        try {
            // If response is already an object, stringify it first
            if (typeof response === 'object') {
                response = JSON.stringify(response);
            }
            
            // Remove markdown code blocks if present
            response = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            
            // Remove any leading/trailing whitespace
            response = response.trim();
            
            // Find the first { and last } to extract just the JSON
            const firstBrace = response.indexOf('{');
            const lastBrace = response.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                response = response.substring(firstBrace, lastBrace + 1);
            }
            
            return response;
        } catch (error) {
            logger.error('Error cleaning JSON response:', error);
            return response;
        }
    }
}

export default AIAttributeExtractor;
