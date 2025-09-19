// services/ingest.js
import Parser from "rss-parser";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";

dotenv.config();

const parser = new Parser();
const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || "http://127.0.0.1:6333" });

const COLLECTION_NAME = "news_articles";
const VECTOR_SIZE = 1024;
const MAX_TEXT_LENGTH = 1000;
const MAX_ARRAY_ITEM_LENGTH = 200;

/**
 * Sanitize payload for Qdrant
 */
function sanitizePayload(payload) {
  const clean = {};
  for (const key in payload) {
    let value = payload[key];

    if (typeof value === "string") {
      value = value
        .normalize("NFC")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u2026/g, "...")
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .slice(0, MAX_TEXT_LENGTH);
      clean[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      clean[key] = value;
    } else if (Array.isArray(value)) {
      clean[key] = value.map((v) => String(v).slice(0, MAX_ARRAY_ITEM_LENGTH));
    } else {
      clean[key] = String(value).slice(0, MAX_TEXT_LENGTH);
    }
  }
  return clean;
}

/**
 * Embed text using Jina
 */
async function embedWithJina(text) {
  const res = await axios.post(
    "https://api.jina.ai/v1/embeddings",
    { model: "jina-embeddings-v3", task: "text-matching", input: [text] },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.JINA_API_KEY}`,
      },
    }
  );

  const vector = res.data?.data?.[0]?.embedding;
  if (!vector || vector.length !== VECTOR_SIZE) {
    throw new Error(`Invalid embedding size: ${vector?.length}`);
  }
  return vector;
}

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
 * Reset collection (delete + recreate)
 */
async function resetCollection() {
  try {
    await qdrant.deleteCollection(COLLECTION_NAME);
    console.log(`🗑️ Deleted old collection "${COLLECTION_NAME}"`);
  } catch (err) {
    if (!err.message.includes("not found")) {
      console.error("⚠️ Failed to delete collection:", err.message);
    }
  }
  await ensureCollection();
}

/**
 * Ingest RSS articles
 */
export async function ingest() {
  await resetCollection();

  const feeds = [
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "https://www.theguardian.com/world/rss",
    "http://feeds.bbci.co.uk/news/rss.xml",
  ];

  let articles = [];
  for (const url of feeds) {
    try {
      const feed = await parser.parseURL(url);
      articles.push(...feed.items.slice(0, 20));
    } catch (err) {
      console.error(`❌ Failed to fetch feed ${url}:`, err.message);
    }
  }

  articles = articles.slice(0, 50);
  console.log(`📥 Processing ${articles.length} articles`);

  for (const item of articles) {
    const text = item.contentSnippet || item.title || "No content";
    try {
      const vector = await embedWithJina(text);

      await qdrant.upsert(COLLECTION_NAME, {
        points: [
          {
            id: uuidv4(),
            vector,
            payload: sanitizePayload({
              text,
              title: item.title || "No title",
              link: item.link || "",
            }),
          },
        ],
      });

      console.log(`✅ Inserted: ${item.title}`);
    } catch (err) {
      console.error(`⚠️ Failed article "${item.title}":`, err.message);
    }
  }

  console.log(`🎉 Finished ingesting ${articles.length} articles`);
}
