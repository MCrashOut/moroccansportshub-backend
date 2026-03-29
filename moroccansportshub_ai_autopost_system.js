// moroccansportshub_ai_autopost_system.js

import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Firebase init
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
});
const db = admin.firestore();

// =========================
// BUFFER CONFIG
// =========================
const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const FACEBOOK_CHANNEL_ID = process.env.BUFFER_FACEBOOK_CHANNEL_ID;
const TWITTER_CHANNEL_ID = process.env.BUFFER_TWITTER_CHANNEL_ID;

// =========================
// AI GENERATOR (example)
// =========================
async function generatePost() {
  const prompt = "Give me a short viral football post about Morocco.";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  return data.choices[0].message.content;
}

// =========================
// POST TO BUFFER
// =========================
async function postToBuffer(text) {
  try {
    const body = {
      query: `
        mutation CreateUpdate($input: CreateUpdateInput!) {
          createUpdate(input: $input) {
            update {
              id
            }
          }
        }
      `,
      variables: {
        input: {
          text,
          profileIds: [FACEBOOK_CHANNEL_ID, TWITTER_CHANNEL_ID],
        },
      },
    };

    const res = await fetch("https://api.bufferapp.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BUFFER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log("✅ Posted to Buffer:", data);
  } catch (err) {
    console.error("❌ Buffer error:", err);
  }
}

// =========================
// SAVE + POST FLOW
// =========================
async function createAndPost() {
  const text = await generatePost();

  // Save to Firestore
  await db.collection("posts").add({
    text,
    createdAt: new Date(),
  });

  // Send to Buffer
  await postToBuffer(text);

  return text;
}

// =========================
// ROUTES
// =========================

// manual trigger
app.get("/force-autopost", async (req, res) => {
  try {
    const post = await createAndPost();
    res.send({ success: true, post });
  } catch (err) {
    res.status(500).send(err);
  }
});

// health
app.get("/", (req, res) => {
  res.send("Server running 🚀");
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
