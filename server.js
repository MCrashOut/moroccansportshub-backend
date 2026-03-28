require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const { startAiAutoPostSystem, runAutoPost } = require('./moroccansportshub_ai_autopost_system');

// 🔥 INIT FIREBASE ADMIN (from Railway env)
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing.');
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ✅ START AI AUTOPOST SYSTEM
startAiAutoPostSystem({ db });

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.send('Moroccansportshub AI backend is running.');
});

// 🔥 YOUR EXISTING AI ROUTE
app.post('/api/ask', async (req, res) => {
  try {
    const { question, siteContext = [] } = req.body || {};

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required.' });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server API key is missing.' });
    }

    const contextText =
      Array.isArray(siteContext) && siteContext.length
        ? `Website context:\n${siteContext.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n`
        : '';

    const prompt = `
You are the sports assistant for Moroccansportshub.

Rules:
- Only answer sports questions.
- First use the website context if it contains the answer.
- If the website context is enough, answer from it clearly.
- If the website context is not enough, answer using general sports knowledge.
- If you are not confident, say you are not fully sure.
- Do not invent facts.
- Keep answers short and useful.
- If a website source is relevant, tell the user to open the matching source link.

${contextText}User question: ${question}
`.trim();

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Gemini request failed.'
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ').trim() ||
      'No answer returned.';

    res.json({ answer: text });
  } catch (error) {
    console.error('AI backend error:', error);
    res.status(500).json({
      error: error.message || 'Server error.'
    });
  }
});

// ✅ TEST AUTOPOST ROUTE
app.get('/test-autopost', async (_req, res) => {
  try {
    const result = await runAutoPost(db);
    res.json(result);
  } catch (err) {
    console.error('test-autopost error:', err);
    res.status(500).json({ error: err.message || 'Error' });
  }
});

// ✅ AUTOPOST STATUS ROUTE
app.get('/autopost-status', (_req, res) => {
  res.json({
    ok: true,
    timezone: process.env.AUTOPOST_TIMEZONE || 'Africa/Casablanca',
    requireImage: (process.env.AUTOPOST_REQUIRE_IMAGE || 'true').toLowerCase() !== 'false',
    dailyTarget: Number(process.env.AUTOPOST_DAILY_TARGET || 5),
    moroccanTargetPerDay: Number(process.env.AUTOPOST_MOROCCAN_TARGET_PER_DAY || 3),
    avatarUrl: process.env.AI_AUTOPOST_AVATAR_URL || ''
  });
});

app.listen(PORT, () => {
  console.log(`AI backend listening on port ${PORT}`);
});
