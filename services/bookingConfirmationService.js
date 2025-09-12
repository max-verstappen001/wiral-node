import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import logger from "../utils/logger.js";

class BookingConfirmationService {
    constructor() {
        this.llm = new ChatOpenAI({
            modelName: "gpt-4o-mini",
            temperature: 0.1,
            openAIApiKey: process.env.OPENAI_API_KEY,
        });

        // Simple in-memory storage for confirmation status
        // In production, this should be stored in database
        this.pendingBookings = new Map();

        this.confirmationDetectionPrompt = PromptTemplate.fromTemplate(`
You are analyzing customer messages to determine if they are confirming a booking summary.

Recent conversation messages:
{messages}

Customer Attributes:
{attributes}

Look for confirmation keywords and phrases such as:
- "yes", "yeah", "yep", "correct", "right", "ok", "okay"
- "confirm", "book it", "go ahead", "proceed", "schedule it"
- "that's right", "sounds good", "perfect", "looks good"

Also look for rejection keywords:
- "no", "nope", "not right", "wrong", "change", "different"
- "cancel", "don't book", "wait"

Return your analysis in this JSON format:
{{
  "isConfirmation": true/false,
  "isRejection": true/false,
  "confidence": 0.85,
  "reasoning": "Brief explanation of why this is/isn't a confirmation"
}}
`);

        this.confirmationChain = RunnableSequence.from([
            this.confirmationDetectionPrompt,
            this.llm,
            new JsonOutputParser()
        ]);
    }

    // Generate a booking summary for confirmation
    generateBookingSummary(schedulingDetails) {
        const { customerName, pickupDate, pickupTime, pickupAddress, serviceType, notes } = schedulingDetails;
        
        return `📋 **Booking Summary**

🏷️ **Customer:** ${customerName}
📅 **Date:** ${pickupDate}
⏰ **Time:** ${pickupTime}
📍 **Address:** ${pickupAddress}
🚚 **Service:** ${serviceType}
${notes ? `📝 **Notes:** ${notes}` : ''}

Please confirm if these details are correct by replying with "yes" or "confirm". If you need to make any changes, please let me know what needs to be updated.`;
    }

    // Check if booking needs confirmation
    needsConfirmation(conversationId) {
        return !this.pendingBookings.has(conversationId);
    }

    // Mark booking as pending confirmation
    setPendingConfirmation(conversationId, schedulingDetails) {
        this.pendingBookings.set(conversationId, {
            details: schedulingDetails,
            timestamp: new Date(),
            status: 'pending'
        });
        logger.info(`Set pending confirmation for conversation ${conversationId}`);
    }

    // Get pending booking details
    getPendingBooking(conversationId) {
        return this.pendingBookings.get(conversationId);
    }

    // Mark booking as confirmed
    confirmBooking(conversationId) {
        const booking = this.pendingBookings.get(conversationId);
        if (booking) {
            booking.status = 'confirmed';
            booking.confirmedAt = new Date();
            logger.info(`Booking confirmed for conversation ${conversationId}`);
            return booking.details;
        }
        return null;
    }

    // Clear booking data
    clearBooking(conversationId) {
        this.pendingBookings.delete(conversationId);
        logger.info(`Cleared booking data for conversation ${conversationId}`);
    }

    // Detect if customer is confirming or rejecting
    async detectConfirmation(messages, currentAttributes = {}) {
        try {
            // Format messages for analysis
            const formattedMessages = messages.slice(-5).map(msg => 
                `${msg.sender_type || 'User'}: ${msg.content}`
            ).join('\n');

            // Format attributes
            const attributesText = Object.entries(currentAttributes)
                .filter(([key, value]) => value && value !== 'none')
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ') || 'None provided yet';

            const result = await this.confirmationChain.invoke({
                messages: formattedMessages,
                attributes: attributesText
            });

            // Validate and clean the result
            if (!result) {
                return {
                    isConfirmation: false,
                    isRejection: false,
                    confidence: 0,
                    reasoning: 'No valid response from AI'
                };
            }

            return {
                isConfirmation: result.isConfirmation || false,
                isRejection: result.isRejection || false,
                confidence: result.confidence || 0,
                reasoning: result.reasoning || 'No reasoning provided'
            };

        } catch (error) {
            logger.error('Error in confirmation detection:', error);
            return {
                isConfirmation: false,
                isRejection: false,
                confidence: 0,
                reasoning: 'Error occurred during detection'
            };
        }
    }

    // Clean up old pending bookings (cleanup utility)
    cleanupOldBookings() {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        for (const [conversationId, booking] of this.pendingBookings.entries()) {
            if (booking.timestamp < oneHourAgo && booking.status === 'pending') {
                this.pendingBookings.delete(conversationId);
                logger.info(`Cleaned up old pending booking for conversation ${conversationId}`);
            }
        }
    }
}

export default BookingConfirmationService;