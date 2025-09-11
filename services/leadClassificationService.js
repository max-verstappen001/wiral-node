import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import logger from "../utils/logger.js";

class LeadClassificationService {
    constructor() {
        this.llm = new ChatOpenAI({
            modelName: "gpt-4o-mini",
            temperature: 0.1,
            openAIApiKey: process.env.OPENAI_API_KEY,
        });

        this.classificationPrompt = PromptTemplate.fromTemplate(`
You are an expert lead classifier. Analyze the conversation and classify the lead based on engagement level and purchase intent.

Classification Guidelines:
- HOT: Strong purchase intent, ready to buy/commit, asking for quotes/pricing, providing detailed requirements, showing urgency, requesting immediate action
- WARM: Moderate interest, asking specific questions about products/services, comparing options, in evaluation phase, seeking more information before deciding
- COLD: Initial inquiry, general questions, browsing, no immediate need expressed, minimal engagement

Conversation Messages:
{messages}

Current Customer Attributes:
{attributes}

Missing Information: {missingInfo}

Based on the conversation flow, customer engagement level, questions asked, and information provided, classify this lead appropriately.

Return your response in this exact JSON format:
{{
  "category": "HOT|WARM|COLD",
  "score": 0.85,
  "reasoning": "Brief explanation of the classification"
}}
`);

        this.classificationChain = RunnableSequence.from([
            this.classificationPrompt,
            this.llm,
            new JsonOutputParser()
        ]);
    }

    async classifyLead(messages, currentAttributes = {}, missingAttributes = []) {
        try {
            // Format messages for analysis
            const formattedMessages = messages.map(msg => 
                `${msg.sender_type || 'User'}: ${msg.content}`
            ).join('\n');

            // Format attributes
            const attributesText = Object.entries(currentAttributes)
                .filter(([key, value]) => value && value !== 'none')
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ') || 'None provided yet';

            const missingInfoText = missingAttributes.length > 0 
                ? missingAttributes.join(', ') 
                : 'All information collected';

            const result = await this.classificationChain.invoke({
                messages: formattedMessages,
                attributes: attributesText,
                missingInfo: missingInfoText
            });

            // Validate and clean the result
            if (!result || !result.category) {
                logger.warn('Invalid classification result, defaulting to warm');
                return {
                    category: 'warm',
                    score: 0.5,
                    reasoning: 'Default classification due to invalid AI response'
                };
            }

            // Ensure category is lowercase and valid
            const validCategories = ['hot', 'warm', 'cold'];
            const category = result.category.toString().toLowerCase();
            
            if (!validCategories.includes(category)) {
                logger.warn(`Invalid category ${category}, defaulting to warm`);
                return {
                    category: 'warm',
                    score: 0.5,
                    reasoning: 'Default classification due to invalid category'
                };
            }

            return {
                category: category,
                score: result.score || 0.5,
                reasoning: result.reasoning || 'No reasoning provided'
            };

        } catch (error) {
            logger.error('Error in lead classification:', error);
            // Return default classification on error
            return {
                category: 'warm',
                score: 0.5,
                reasoning: 'Default classification due to processing error'
            };
        }
    }
}

export default LeadClassificationService;
