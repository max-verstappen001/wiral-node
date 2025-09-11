import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import logger from "../utils/logger.js";
import { config } from "../config/appConfig.js";
import RagService from "../service/ragService1.js";

class AIService {
    constructor() {
        this.model = config.MODEL;
        this.embeddings = new OpenAIEmbeddings({
            apiKey: config.OPENAI_API_KEY,
            model: config.EMBEDDING_MODEL,
        });

        this.llm = new ChatOpenAI({
            apiKey: config.OPENAI_API_KEY,
            model: this.model,
            temperature: 0.4,
        });

        this.ragService = new RagService();
        this.initializeChain();
    }

    initializeChain() {
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
7. Never make up information or speculate.
8. Be natural and conversational - avoid sounding robotic or overly formal.
9. Continue the conversation naturally - avoid unnecessary greetings like "Welcome back" unless it's actually a new conversation after a long break.
10. If the user just provided information you requested, acknowledge it and smoothly continue to the next step.
11. If user says they don't know something (like "Idk"), don't keep pushing - acknowledge it and move on to help with what you have.
12. Never be overly persistent about missing information - if user seems unsure, provide helpful context or proceed with available information.

ATTRIBUTE STATUS:
- Missing attributes that need collection: {missing_attributes}
- Currently collected attributes: {current_attributes}

CONVERSATION FLOW:
Analyze the recent conversation to understand the context and flow. Respond appropriately based on what just happened.
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
- Continue the conversation naturally based on the recent context
- If the user just provided requested information, acknowledge it and proceed to next steps
- If multiple policies conflict, ask clarifying questions
- Handle any information updates naturally without being repetitive`,
            ],
        ]);

        this.chain = RunnableSequence.from([
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
                const hits = await this.retrieveKBChunks(account_id, user_text, 10);
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
            this.llm,
            new StringOutputParser(),
        ]);
    }

    async retrieveKBChunks(accountId, query, topK = 10) {
        try {
            const results = await this.ragService.searchDocuments({
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

    async generateResponse(input, callbacks = []) {
        try {
            return await this.chain.invoke(input, { callbacks });
        } catch (error) {
            logger.error(`Error generating AI response:`, error.message);
            throw error;
        }
    }

    calculateCost(tokenUsage) {
        const modelPricing = config.PRICING[this.model] || { input: 0, output: 0 };
        const inputTokens = tokenUsage.promptTokens || 0;
        const outputTokens = tokenUsage.completionTokens || 0;
        const costUsd = (inputTokens / 1000) * modelPricing.input + (outputTokens / 1000) * modelPricing.output;

        return {
            inputTokens,
            outputTokens,
            totalTokens: tokenUsage.totalTokens || 0,
            costUsd
        };
    }
}

export default AIService;
