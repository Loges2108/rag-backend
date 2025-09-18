# RAG Backend with Gemini and Local Qdrant

This project is a **Retrieval-Augmented Generation (RAG)** backend built with Node.js.  
It combines **vector search** using **Qdrant** and **language generation** using **Gemini API** to answer user queries based on stored articles.

---

## Features

- Embed user queries using **Jina embeddings**.
- Store and retrieve articles in **local Qdrant**.
- Generate context-aware answers using **Gemini API**.
- Retry mechanism and exponential backoff for temporary API failures.
- Conversation history limited to last 5 messages to avoid large prompts.
- Graceful fallback if Gemini API is unavailable.

---

## Prerequisites

- Node.js >= 18
- Local **Qdrant** instance running at `http://localhost:6333`
- API Keys:
  - **Jina API Key**
  - **Gemini API Key**

---

## Installation

```bash
git clone https://github.com/Loges2108/rag-backend.git
cd rag-backend
npm install
