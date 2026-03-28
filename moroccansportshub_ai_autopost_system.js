const cron = require("node-cron");
const Parser = require("rss-parser");

const parser = new Parser();

const FEEDS = [
  "https://www.le360.ma/rss/sport",
  "https://www.hespress.com/sport/feed",
  "https://www.espn.com/espn/rss/news",
  "https://feeds.bbci.co.uk/sport/rss.xml"
];

function normalizeTitle(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFingerprint(item) {
  return normalizeTitle(item.title || "").slice(0, 180);
}

function scoreItem(item, sourceCountMap) {
  const ageMs = Date.now() - new Date(item.isoDate || item.pubDate || Date.now()).getTime();
  const ageHours = Math.max(ageMs / (1000 * 60 * 60), 0);
  const recencyScore = Math.max(0, 48 - ageHours);
  const sourceScore = sourceCountMap.get(buildFingerprint(item)) || 1;
  return recencyScore + sourceScore * 10;
}

function generatePostText(item) {
  const title = (item.title || "Sports update").trim();
  const source = item.link || "";
  const summary = (item.contentSnippet || item.content || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  const lines = [
    "🧠 AI Sports Update",
    "",
    title,
    "",
    summary || "Fresh sports update from today’s coverage.",
    "",
    source ? `Source: ${source}` : "",
    "#sports #morocco #football"
  ].filter(Boolean);

  return lines.join("\n");
}

async function fetchAllNews() {
  const allItems = [];

  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      const items = Array.isArray(feed.items) ? feed.items : [];

      for (const item of items.slice(0, 20)) {
        allItems.push({
          ...item,
          _feedUrl: url
        });
      }
    } catch (err) {
      console.error("Feed error:", url, err.message);
    }
  }

  return allItems;
}

async function alreadyPosted(db, fingerprint) {
  const snap = await db.collection("ai_autopost_history")
    .where("fingerprint", "==", fingerprint)
    .limit(1)
    .get();

  return !snap.empty;
}

async function markAsPosted(db, item, fingerprint) {
  await db.collection("ai_autopost_history").add({
    title: item.title || "",
    link: item.link || "",
    fingerprint,
    createdAt: new Date()
  });
}

async function createPost(db, item) {
  const avatar = process.env.AI_AUTOPOST_AVATAR_URL || "";

  const post = {
    username: "Rabii El Baghdadi",
    badge: "AI",
    avatarUrl: avatar,
    content: generatePostText(item),
    likes: 0,
    hearts: 0,
    fires: 0,
    pinned: false,
    score: 0,
    createdAt: new Date()
  };

  await db.collection("posts").add(post);
}

async function runAutoPost(db) {
  console.log("🧠 Running AI auto-post...");

  const allNews = await fetchAllNews();

  if (!allNews.length) {
    throw new Error("No feed items found.");
  }

  const countMap = new Map();
  for (const item of allNews) {
    const fp = buildFingerprint(item);
    countMap.set(fp, (countMap.get(fp) || 0) + 1);
  }

  const ranked = [...allNews]
    .filter(item => item.title && item.link)
    .sort((a, b) => scoreItem(b, countMap) - scoreItem(a, countMap));

  for (const item of ranked) {
    const fingerprint = buildFingerprint(item);
    const exists = await alreadyPosted(db, fingerprint);

    if (!exists) {
      await createPost(db, item);
      await markAsPosted(db, item, fingerprint);
      console.log("✅ Posted:", item.title);
      return { ok: true, title: item.title };
    }
  }

  return { ok: true, skipped: true, reason: "No fresh unique story found." };
}

function startAiAutoPostSystem({ db }) {
  const timezone = process.env.AUTOPOST_TIMEZONE || "Africa/Casablanca";

  console.log("🚀 AI AutoPost system started");

  cron.schedule("0 9,12,15,18,21 * * *", async () => {
    try {
      await runAutoPost(db);
    } catch (err) {
      console.error("AutoPost error:", err);
    }
  }, { timezone });
}

module.exports = {
  startAiAutoPostSystem,
  runAutoPost
};
