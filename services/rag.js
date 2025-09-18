import axios from "axios";
import { QdrantClient } from "@qdrant/js-client-rest";

const qdrant = new QdrantClient({ url: process.env.QDRANT_URL });
const COLLECTION_NAME = "news_articles";
const VECTOR_SIZE = 1024;
const MAX_HISTORY = 5;

/** Embed query using Jina */
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

/** Retrieve top-K similar articles from Qdrant */
async function retrieve(vector, topK = 3) {
  const res = await qdrant.search(COLLECTION_NAME, { vector, limit: topK });
  return (res.result || []).map(r => r.payload?.text || "");
}

/** Call Gemini API with retry & exponential backoff */
async function askGemini(conversation, retries = 5, delay = 1000) {
  const trimmedConversation = conversation.slice(-MAX_HISTORY);

  const requestBody = {
    contents: trimmedConversation.map(msg => ({
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
        return content.parts.map(p => p.text).join(" ");
      }

      return "No answer from Gemini.";
    } catch (err) {
      if (err.response?.status === 503) {
        console.warn(`503 Service Unavailable. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else {
        console.error("Gemini request failed:", err.message);
        throw err;
      }
    }
  }

  return "Sorry, the assistant is temporarily unavailable. Please try again later.";
}



/** RAG pipeline: fetch context & call Gemini */
export async function ragPipeline(userMessage) {
  const vector = await embedQuery(userMessage);
  const contextDocs = await retrieve(vector);

  const conversation = [
    ...contextDocs.map(text => ({ role: "system", text })),
    { role: "user", text: userMessage },
  ];

  const answer = await askGemini(conversation);
  return answer;
}
