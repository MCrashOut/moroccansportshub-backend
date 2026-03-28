const cron = require("node-cron");
const Parser = require("rss-parser");
const parser = new Parser();

const FEEDS = [
  "https://www.le360.ma/rss/sport",
  "https://www.hespress.com/sport/feed",
  "https://www.espn.com/espn/rss/news",
  "https://feeds.bbci.co.uk/sport/rss.xml"
];

function generatePostText(title, source) {
  return `🧠 AI Sports Update\n\n${title}\n\nSource: ${source}\n\n#sports #news`;
}

async function fetchNews() {
  for (let url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      if (feed.items && feed.items.length > 0) {
        return feed.items;
      }
    } catch (e) {
      console.log("Feed error:", url);
    }
  }
  return [];
}

async function alreadyPosted(db, title) {
  const snap = await db.collection("ai_autopost_history")
    .where("title", "==", title)
    .get();

  return !snap.empty;
}

async function markAsPosted(db, title) {
  await db.collection("ai_autopost_history").add({
    title,
    createdAt: new Date()
  });
}

async function createPost(db, item) {
  const avatar = process.env.AI_AUTOPOST_AVATAR_URL || "";

  const post = {
    username: "Rabii El Baghdadi",
    badge: "AI",
    content: generatePostText(item.title, item.link),
    avatarUrl: avatar,
    createdAt: new Date(),
    likes: 0,
    hearts: 0,
    fire: 0
  };

  await db.collection("posts").add(post);
}

async function runAutoPost(db) {
  console.log("🧠 Running AI auto-post...");

  const news = await fetchNews();

  for (let item of news) {
    const exists = await alreadyPosted(db, item.title);
    if (!exists) {
      await createPost(db, item);
      await markAsPosted(db, item.title);
      console.log("✅ Posted:", item.title);
      break;
    }
  }
}

function startAiAutoPostSystem({ db }) {
  console.log("🚀 AI AutoPost system started");

  // Run 5 times per day
  cron.schedule("0 9,12,15,18,21 * * *", async () => {
    try {
      await runAutoPost(db);
    } catch (err) {
      console.error("AutoPost error:", err);
    }
  });
}

module.exports = { startAiAutoPostSystem };