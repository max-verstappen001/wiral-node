import express from "express";
import axios from "axios";
import logger from "./utils/logger.js";
import dotenv from "dotenv";
import mongoConnect from "./config/mongoConnect.js";
import os from "os";
import multiFileRagRoutes from "./routes/multiFileRagRoutes.js";

dotenv.config();

const app = express();
app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

// Add RAG routes
app.use('/rag', multiFileRagRoutes);
console.log('RAG routes registered at /rag');


const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/chatwoot-webhook", async (req, res) => {
  // Log the full payload for debugging
  logger.info(`Webhook received: ${JSON.stringify(req.body, null, 2)}`);

  const { content, conversation, sender, message_type } = req.body;

  // retreive the account id from the webhook payload
  const account_id = req.body.account.id;
  const contact_id = req.body.conversation.contact_inbox.contact_id;
  const ACCESS_TOKEN = "JvvqyhEEfSUFcYnaJmmqizsY";
  logger.info(`Account ID: ${account_id}, Contact ID: ${contact_id}`);

  // try {
  //   await axios.patch(
  //     `${process.env.CHATWOOT_URL}/api/v1/accounts/${account_id}/contacts/${contact_id}`,
  //     {
  //       custom_attributes: {
  //         pickup_location: "Mumbai"
  //       }
  //     },
  //     {
  //       headers: {
  //         "Content-Type": "application/json",
  //         api_access_token: ACCESS_TOKEN
  //       },
  //       timeout: 10000 // 10s timeout for Chatwoot API
  //     }
  //   );
  //   logger.info(`Contact ${contact_id} updated with custom attribute.`);
  // } catch (err) {
  //   logger.error(`Failed to update contact ${contact_id}.`, err.response?.data || err.message);
  //   logger.error(err);
  // }

  // CRITICAL: Prevent bot loop by filtering out non-user messages

  // Get sender type from the message object (more reliable)
  const messageSenderType = req.body.conversation?.messages?.[0]?.sender_type;

  // Method 1: Check sender type from message object
  if (messageSenderType === 'AgentBot' || messageSenderType === 'Agent') {
    logger.info(`Ignoring message from bot/agent. Sender type: ${messageSenderType}`);
    return res.sendStatus(200);
  }

  // Method 2: Only process messages from contacts/users
  if (messageSenderType && messageSenderType !== 'Contact') {
    logger.info(`Ignoring non-contact message. Sender type: ${messageSenderType}`);
    return res.sendStatus(200);
  }

  // Method 3: Fallback check on top-level sender (though it seems to be undefined)
  if (sender?.type && sender.type !== 'contact') {
    logger.info(`Ignoring non-contact message. Top-level sender type: ${sender?.type}`);
    return res.sendStatus(200);
  }

  // Method 3: Check message type (incoming vs outgoing)
  if (message_type && message_type !== 'incoming') {
    logger.info(`Ignoring ${message_type} message`);
    return res.sendStatus(200);
  }

  // Method 4: Additional check for empty content
  if (!content || content.trim() === '') {
    logger.info(`Ignoring empty message`);
    return res.sendStatus(200);
  }

  logger.info(`Processing message: "${content}" from conversation ${conversation?.id}, sender: ${sender?.name || 'unknown'}, sender_type: ${messageSenderType}`);

  // retreive recent messages in the conversation for context (optional) 
  try {
    const response = await axios.get(
      `${process.env.CHATWOOT_URL}/api/v1/accounts/${account_id}/conversations/${conversation.id}/messages?per_page=100`,
      {
        headers: {
          "Content-Type": "application/json",
          api_access_token: ACCESS_TOKEN
        },
        timeout: 10000 // 10s timeout for Chatwoot API
      }
    )

    const messages = response.data.payload;
    const lastMessages = messages.slice(-20);
    logger.info(`Fetched ${lastMessages.length} recent messages for context.`);
    // Optionally, you could build a more complex context here by concatenating messages
    // For simplicity, we are just logging them
    lastMessages.forEach(msg => {
      logger.info(`Message from ${msg.sender.id}, ${msg.sender.name}, ${msg.sender.type}: ${msg.content}`);
    });
  } catch (err) {
    logger.error(`Error in chats retreival ${err.message}`);
  }

  try {
    // Send message to OpenAI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content }]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000 // 15s timeout in case OpenAI is slow
      }
    );

    const aiReply = response.data.choices[0].message.content;
    logger.info(`AI reply generated: "${aiReply}"`);

    // Send reply back to Chatwoot
    await axios.post(
      `${process.env.CHATWOOT_URL}/api/v1/accounts/${account_id}/conversations/${conversation.id}/messages`,
      {
        content: aiReply,
        message_type: 'outgoing' // Explicitly mark as outgoing
      },
      {
        headers: {
          "Content-Type": "application/json",
          api_access_token: process.env.CHATWOOT_BOT_TOKEN
        },
        timeout: 10000 // 10s timeout for Chatwoot API
      }
    );

    logger.info(`Reply sent back to Chatwoot conversation ${conversation.id}`);
    res.sendStatus(200);

  } catch (err) {
    if (err.response) {
      // API responded with error status
      logger.error(
        `API Error (status: ${err.response.status}): ${JSON.stringify(err.response.data)}`
      );
    } else if (err.request) {
      // No response received
      logger.error("No response received from API: " + err.message);
    } else {
      // Other errors
      logger.error("Error setting up request: " + err.message);
    }
    res.sendStatus(500);
  }
});

// Health check endpoint (optional)
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    hostname: os.hostname(), pid: process.pid,
    memoryUsage: process.memoryUsage()
  });
});

app.listen(3009, () => {
  mongoConnect();
  logger.info("AI Bot running on port 3009");
  logger.info("Environment check:");
  logger.info(`- CHATWOOT_URL: ${process.env.CHATWOOT_URL ? 'Set' : 'Missing'}`);
  logger.info(`- CHATWOOT_BOT_TOKEN: ${process.env.CHATWOOT_BOT_TOKEN ? 'Set' : 'Missing'}`);
  logger.info(`- OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'Set' : 'Missing'}`);
});
