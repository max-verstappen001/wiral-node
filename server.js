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


// RAG Service
import RagService from "./service/ragService1.js";
const ragServices = new RagService();

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
    const results = await ragService.searchDocuments({
      account_id: accountId,
      query,
      limit: topK,
      searchMethod: "hybrid" // Use hybrid search for better relevance
      // limit: topK --- IGNORE ---
    });

    logger.info(`Retrieved ${results.length} KB chunks for account ${accountId} and query "${query}"`);

    return results.map(result => ({
      content: result.content,
      document_id: result.documentId,
      source_title: result.title,
      source_uri: result.source || result.title,
      score: result.similarity
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

// ---------- Langfuse ----------
// Using shared Langfuse service for better tracing

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
    const existingKeys = new Set(defs.map(d => d.attribute_key));
    return Array.from(existingKeys) || [];
  } catch (error) {
    logger.error(`[DEBUG] Error fetching attributes for account ${accountId}:`, error.message);
    return [];
  }
}

// Simplified token usage tracking using direct LLM callbacks

// ---------- LLM + Prompt ----------
const MODEL = "gpt-4o-mini";

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are the AI Support Agent for {account_name}.
Always answer ONLY using the context below (snippets from this account's knowledge base and recent conversation).
If the answer is not clearly supported by the context, ask a clarifying question or suggest escalation.
Always cite sources in the format [Title]. Keep your answers concise, helpful, and grounded in the provided information.
Never answer questions about topics not present in the context. Do not make up information or speculate.
Greet the user by name if you know it, otherwise use a generic greeting.
If multiple policies or answers conflict, ask a clarifying question.
`,
  ],
  [
    "human",
    `User message:
{user}

Recent conversation (most recent last):
{recent_transcript}

Knowledge snippets:
{kb}

Don't answer questions about topics not in the context.
Don't do anything that isn't in the context above.
Make sure to ground your answer in the provided context.
your a chat agent for {account_name}.
Greet the user by name if you know it.
If you don't know the user's name, use a generic greeting.

Produce a direct answer for the user. If multiple policies conflict, ask a clarifying question.`,

  ],
]);

const llm = new ChatOpenAI({
  apiKey: OPENAI_API_KEY,
  model: MODEL,
  temperature: 0.1,
});

const chain = RunnableSequence.from([
  async (input) => {
    const { account_id, account_name, user_text, recent_messages, system_prompt, attributes } = input;

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

    return {
      account_id,
      account_name,
      user: user_text,
      recent_transcript: transcript,
      kb: kbBlock || "No KB snippets available.",
    };
  },
  prompt,
  llm,
  new StringOutputParser(),
]);

// Mount RAG routes
app.use("/api/rag", ragRoutes);

// Mount Enhanced RAG routes with Firecrawl support
app.use("/api/rag-enhanced", enhancedRagRoutes);

// Mount Azure upload routes
app.use("/api/azure", azureUploadRoutes);

// Mount Azure RAG routes
app.use("/api/azure-rag", azureRagRoutes);

// Mount Multi-File RAG routes
app.use("/api/multi-rag", multiFileRagRoutes);

// ---------- Webhook ----------
app.post("/chatwoot-webhook", async (req, res) => {
  logger.info(`Webhook received: ${JSON.stringify(req.body, null, 2)}`);

  const { content, conversation, sender, message_type } = req.body;
  const account_id = req.body.account?.id;
  const contact_id = req.body.conversation?.contact_inbox?.contact_id;

  logger.info(`Account ID: ${account_id}, Contact ID: ${contact_id}`);

  // Loop prevention
  const messageSenderType = req.body.conversation?.messages?.[0]?.sender_type;
  if (messageSenderType === "AgentBot" || messageSenderType === "Agent") {
    logger.info(`Ignoring message from bot/agent. Sender type: ${messageSenderType}`);
    return res.sendStatus(200);
  }
  if (messageSenderType && messageSenderType !== "Contact") {
    logger.info(`Ignoring non-contact message. Sender type: ${messageSenderType}`);
    return res.sendStatus(200);
  }
  if (sender?.type && sender.type !== "contact") {
    logger.info(`Ignoring non-contact message. Top-level sender type: ${sender?.type}`);
    return res.sendStatus(200);
  }
  if (message_type && message_type !== "incoming") {
    logger.info(`Ignoring ${message_type} message`);
    return res.sendStatus(200);
  }
  if (!content || String(content).trim() === "") {
    logger.info(`Ignoring empty message`);
    return res.sendStatus(200);
  }

  const attributes = await getAttributes(account_id);

  const conversationId = conversation?.id;
  const accountName = req.body.account?.name || `Account ${account_id}`;

  try {
    const client = await Client.findOne({ account_id: account_id, is_active: true });
    if (!client) {
      logger.info(`No active client found for account_id ${account_id}. Skipping AI response.`);
      return res.sendStatus(200);
    }
  } catch (error) {
    logger.error(`Error querying Client for account_id ${account_id}:`, error.message);
    return res.sendStatus(500);
  }

  try {
    const token = await Client.findOne({ account_id: account_id, is_active: true })
    const CHATWOOT_BOT_TOKEN = token?.bot_api_key;
    const api_access_token = token?.api_key;
    const systemPrompt = token?.system_prompt || null;

    if (!CHATWOOT_BOT_TOKEN) {
      logger.warn(`No bot_api_key found for account_id ${account_id}. Cannot send replies.`);
      return res.sendStatus(200);
    }
    if (!api_access_token) {
      logger.warn(`No api_key found for account_id ${account_id}. Cannot retrieve documents.`);
      return res.sendStatus(200);
    }

    const lastMessages = await fetchLastMessages(account_id, conversationId, 20, api_access_token);
    logger.info(`Fetched ${lastMessages.length} recent messages for context.`);

    // 2) Create Langfuse trace for observability
    const trace = await sharedLangfuseService.createTrace(
      account_id.toString(),
      `conversation_${conversationId}`,
      {
        account_id: account_id,
        user_message: content,
        conversation_id: conversationId,
        account_name: accountName,
      },
      {
        conversation_id: conversationId,
        contact_id: contact_id,
        message_type: message_type,
        channel: req.body?.inbox?.name || "unknown"
      }
    );

    // 3) Generate reply with LangChain
    logger.info(`[DEBUG] Starting AI chain invocation for account ${account_id}`);
    logger.info(`[DEBUG] User text: "${content}"`);
    logger.info(`[DEBUG] Recent messages count: ${lastMessages.length}`);

    // Track tokens from direct LLM callback
    let tokenUsageFromResponse = null;


    const aiReply = await chain.invoke(
      {
        account_id,
        account_name: accountName,
        user_text: content,
        recent_messages: lastMessages,
        system_prompt: systemPrompt,
        attributes: attributes,
        // data: data

      },
      {
        callbacks: [
          {
            // Capture LLM token usage directly
            handleLLMEnd: async (output) => {
              tokenUsageFromResponse = output?.llmOutput?.tokenUsage || output?.llmOutput?.usage;
              if (tokenUsageFromResponse) {
                logger.info(`[TOKEN] Captured usage - prompt: ${tokenUsageFromResponse.promptTokens}, completion: ${tokenUsageFromResponse.completionTokens}, total: ${tokenUsageFromResponse.totalTokens}`);
              }
            }
          }
        ],
        runName: "wiral-rag-reply",
        tags: [`account:${account_id}`, `conversation:${conversationId}`],
        metadata: { account_id, conversation_id: conversationId, contact_id },
      }
    );

    logger.info(`[DEBUG] AI reply generated: "${aiReply}"`);

    // Use captured token data
    const finalTokenUsage = {
      promptTokens: tokenUsageFromResponse?.promptTokens || 0,
      completionTokens: tokenUsageFromResponse?.completionTokens || 0,
      totalTokens: tokenUsageFromResponse?.totalTokens || 0
    };    // 4) Compute cost and log to Langfuse for billing aggregation
    const modelPricing = PRICING[MODEL] || { input: 0, output: 0 };
    const inputTokens = finalTokenUsage.promptTokens;
    const outputTokens = finalTokenUsage.completionTokens;
    const costUsd = (inputTokens / 1000) * modelPricing.input + (outputTokens / 1000) * modelPricing.output;

    // Update trace with the AI response and token usage
    if (trace) {
      await sharedLangfuseService.updateTrace(trace,
        {
          ai_response: aiReply,
          success: true
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

      // Log usage data for analytics
      await sharedLangfuseService.logUsage(account_id.toString(), {
        model: MODEL,
        input: content,
        output: aiReply,
        endpoint: "chatwoot_webhook",
        tokens_used: finalTokenUsage.totalTokens,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost: costUsd,
        processing_time: Date.now(),
        success: true
      });

      // Log cost information
      await sharedLangfuseService.logCost(account_id.toString(), {
        transaction_type: "ai_response",
        amount: costUsd,
        model: MODEL,
        tokens_used: finalTokenUsage.totalTokens,
        conversation_id: conversationId
      });
    }

    logger.info(
      `AI reply (tokens in/out/total ${inputTokens}/${outputTokens}/${finalTokenUsage.totalTokens}) ~ $${costUsd.toFixed(6)}`
    );

    // 5) Send reply to Chatwoot
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
      langfuse_message: langfuseHealth.message
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

// ---------- Boot ----------
async function start() {
  try {
    console.log("Starting server...");

    // Connect to MongoDB
    await mongoConnect();

    // Initialize Langfuse service
    await sharedLangfuseService.initialize();


    app.listen(3009, () => {
      logger.info("Enhanced AI Bot with RAG service running on port 3009");
      logger.info("Environment check:");
      logger.info(`- CHATWOOT_URL: ${process.env.CHATWOOT_URL ? "Set" : "Missing"}`);
      logger.info(`- OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "Set" : "Missing"}`);
      logger.info(`- MONGODB_URI: ${process.env.MONGODB_URI ? "Set" : "Missing"}`);
      logger.info(`- LANGFUSE_ENABLED: ${process.env.LANGFUSE_ENABLED ? "Set" : "Missing"}`);
      logger.info(`- LANGFUSE_BASE_URL: ${process.env.LANGFUSE_BASE_URL ? "Set" : "Missing"}`);
      logger.info(`- LANGFUSE_PUBLIC_KEY: ${process.env.LANGFUSE_PUBLIC_KEY ? "Set" : "Missing"}`);
      logger.info(`- LANGFUSE_SECRET_KEY: ${process.env.LANGFUSE_SECRET_KEY ? "Set" : "Missing"}`);
      logger.info("MongoDB connection: Enabled");
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
