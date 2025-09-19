// server.js
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { createClient } from "redis";
import { ingest } from "./services/ingest.js";
import { ragPipeline } from "./services/rag.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// Redis client
const redisClient = createClient({ url: "redis://127.0.0.1:6379" });
redisClient.on("error", (err) => console.error("Redis Client Error", err));
await redisClient.connect();
console.log("✅ Connected to Redis");

app.use(cors());
app.use(express.json());

/**
 * Create new session
 */
app.post("/session", async (req, res) => {
  const id = uuidv4();
  await redisClient.set(`session:${id}`, JSON.stringify([]));
  res.json({ sessionId: id });
});

/**
 * Chat endpoint
 */
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;
  const historyRaw = await redisClient.get(`session:${sessionId}`);
  const history = historyRaw ? JSON.parse(historyRaw) : [];

  try {
    const answer = await ragPipeline(message, history);
    history.push({ user: message, bot: answer });
    await redisClient.set(`session:${sessionId}`, JSON.stringify(history));
    res.json({ reply: answer });
  } catch (err) {
    console.error("❌ Chat error:", err.message);
    res.status(500).json({ error: "Failed to get response" });
  }
});

/**
 * Get session history
 */
app.get("/history/:id", async (req, res) => {
  const historyRaw = await redisClient.get(`session:${req.params.id}`);
  const history = historyRaw ? JSON.parse(historyRaw) : [];
  res.json(history);
});

/**
 * Clear session
 */
app.delete("/session/:id", async (req, res) => {
  await redisClient.del(`session:${req.params.id}`);
  res.json({ status: "cleared" });
});

/**
 * Start server ONLY after ingestion finishes
 */
async function start() {
  console.log("🚀 Starting article ingestion...");
  try {
    await ingest(); // ensures collection is created + filled
    console.log("✅ Articles ingested successfully");
  } catch (err) {
    console.error("❌ Ingestion failed:", err.message);
  }

  app.listen(PORT, () => {
    console.log(`✅ Backend running on http://localhost:${PORT}`);
  });
}

start();
