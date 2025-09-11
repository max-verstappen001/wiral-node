import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import logger from "../utils/logger.js";

class SchedulingService {
    constructor() {
        this.llm = new ChatOpenAI({
            modelName: "gpt-4o-mini",
            temperature: 0.1,
            openAIApiKey: process.env.OPENAI_API_KEY,
        });

        this.schedulingDetectionPrompt = PromptTemplate.fromTemplate(`
You are an expert at detecting scheduling requests and extracting appointment details from conversations.

Analyze the conversation to determine if the customer wants to schedule a pickup/appointment and extract relevant details.

Conversation Messages:
{messages}

Customer Attributes:
{attributes}

IMPORTANT: Only return wantsToSchedule=true if the customer EXPLICITLY mentions:
1. Scheduling/booking words: "schedule", "book", "arrange", "set up", "plan"
2. Time-related requests: "when can you", "what time", "available", "appointment"
3. Specific dates/times: "tomorrow", "Monday", "next week", specific dates

DO NOT trigger scheduling for:
- General service inquiries ("need to send", "want to ship", "looking for")
- Information gathering messages
- Initial contact messages
- Messages without clear scheduling intent

Look for:
1. Intent to schedule (phrases like "schedule pickup", "book appointment", "when can you come", "arrange collection", etc.)
2. Date/time information (today, tomorrow, specific dates, times)
3. Location/address details
4. Any scheduling preferences

IMPORTANT: When extracting dates, always assume the CURRENT YEAR (${new Date().getFullYear()}) unless explicitly stated otherwise.
- "25 sep" should become "September 25, ${new Date().getFullYear()}"
- "Monday next week" should be calculated from today's date in ${new Date().getFullYear()}
- "tomorrow" means tomorrow in ${new Date().getFullYear()}

CRITICAL: Handle common abbreviations correctly:
- "tmrw", "tmr", "2morrow" = "tomorrow"
- "today", "tdy" = "today"
- "next week", "nxt week" = next week
- Numbers like "22", "23" = day of current month

Return your response in this exact JSON format:
{{
  "wantsToSchedule": true/false,
  "confidence": 0.85,
  "extractedDetails": {{
    "date": "extracted date with year ${new Date().getFullYear()} or null",
    "time": "extracted time or null",
    "address": "extracted address or null",
    "urgency": "urgent/normal/flexible",
    "notes": "any additional scheduling notes"
  }},
  "reasoning": "Brief explanation of why you think they want to schedule"
}}
`);

        this.schedulingChain = RunnableSequence.from([
            this.schedulingDetectionPrompt,
            this.llm,
            new JsonOutputParser()
        ]);
    }

    async detectSchedulingIntent(messages, currentAttributes = {}) {
        try {
            // Format messages for analysis
            const formattedMessages = messages.slice(-10).map(msg => 
                `${msg.sender_type || 'User'}: ${msg.content}`
            ).join('\n');

            // Format attributes
            const attributesText = Object.entries(currentAttributes)
                .filter(([key, value]) => value && value !== 'none')
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ') || 'None provided yet';

            const result = await this.schedulingChain.invoke({
                messages: formattedMessages,
                attributes: attributesText
            });

            // Validate and clean the result
            if (!result) {
                return {
                    wantsToSchedule: false,
                    confidence: 0,
                    extractedDetails: {},
                    reasoning: 'No valid response from AI'
                };
            }

            return {
                wantsToSchedule: result.wantsToSchedule || false,
                confidence: result.confidence || 0,
                extractedDetails: result.extractedDetails || {},
                reasoning: result.reasoning || 'No reasoning provided'
            };

        } catch (error) {
            logger.error('Error in scheduling detection:', error);
            return {
                wantsToSchedule: false,
                confidence: 0,
                extractedDetails: {},
                reasoning: 'Error occurred during detection'
            };
        }
    }

    formatSchedulingDetails(extractedDetails, currentAttributes) {
        return {
            customerName: currentAttributes.lead_name || currentAttributes.customer_name || currentAttributes.name || 'Not provided',
            customerPhone: currentAttributes.lead_contact_number || currentAttributes.contact_number || currentAttributes.phone || 'Not provided',
            customerEmail: currentAttributes.email || 'Not provided',
            pickupDate: extractedDetails.date || 'Not specified',
            pickupTime: extractedDetails.time || 'Not specified',
            pickupAddress: extractedDetails.address || currentAttributes.pickup_address || currentAttributes.address || 'Not provided',
            serviceType: currentAttributes.service_type || 'General Service',
            notes: extractedDetails.notes || '',
            urgency: extractedDetails.urgency || 'normal'
        };
    }
}

export default SchedulingService;
