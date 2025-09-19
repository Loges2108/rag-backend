// services/rag.js
import axios from "axios";
import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";

dotenv.config();

const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || "http://127.0.0.1:6333" });
const COLLECTION_NAME = "news_articles";
const VECTOR_SIZE = 1024;
const MAX_HISTORY = 5;

/**
 * Ensure collection exists
 */
async function ensureCollection() {
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((col) => col.name === COLLECTION_NAME);

    if (!exists) {
      console.log(`⚠️ Collection "${COLLECTION_NAME}" not found. Creating...`);
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      });
      console.log(`✅ Collection "${COLLECTION_NAME}" created.`);
    }
  } catch (err) {
    console.error("❌ Failed to check/create collection:", err.message);
  }
}

/**
 * Embed query text
 */
async function embedQuery(text) {
  const res = await axios.post(
    "https://api.jina.ai/v1/embeddings",
    { model: "jina-embeddings-v3", task: "text-matching", input: [text] },
    { headers: { Authorization: `Bearer ${process.env.JINA_API_KEY}` } }
  );

  const vector = res.data?.data?.[0]?.embedding;
  if (!vector || vector.length !== VECTOR_SIZE) {
    throw new Error(`Invalid embedding size: ${vector?.length}`);
  }
  return vector;
}

/**
 * Retrieve top-K documents
 */
async function retrieve(vector, topK = 3) {
  await ensureCollection();

  const res = await qdrant.search(COLLECTION_NAME, { vector, limit: topK });

  return (res.result || []).map((r) => r.payload?.text || "");
}

/**
 * Ask Gemini API
 */
async function askGemini(conversation, retries = 5, delay = 1000) {
  const trimmedConversation = conversation.slice(-MAX_HISTORY);

  const requestBody = {
    contents: trimmedConversation.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    })),
  };

  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY,
          },
        }
      );

      const candidate = res.data?.candidates?.[0];
      if (!candidate) return "No answer from Gemini.";

      const content = candidate.content;
      if (content?.parts && Array.isArray(content.parts)) {
        return content.parts.map((p) => p.text).join(" ");
      }
      return "No answer from Gemini.";
    } catch (err) {
      if (err.response?.status === 503) {
        console.warn(`⚠️ Gemini 503. Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      } else {
        console.error("❌ Gemini request failed:", err.message);
        throw err;
      }
    }
  }
  return "Sorry, the assistant is temporarily unavailable. Please try again later.";
}

/**
 * RAG pipeline
 */
export async function ragPipeline(userMessage) {
  const vector = await embedQuery(userMessage);
  const contextDocs = await retrieve(vector);

  const conversation = [
    ...contextDocs.map((text) => ({ role: "system", text })),
    { role: "user", text: userMessage },
  ];

  return await askGemini(conversation);
}
