const cron = require("node-cron");
const Parser = require("rss-parser");

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["content:encoded", "contentEncoded"],
      ["enclosure", "enclosure", { keepArray: false }]
    ]
  }
});

const MOROCCAN_FEEDS = [
  "https://www.le360.ma/rss/sport",
  "https://www.hespress.com/sport/feed"
];

const GLOBAL_FEEDS = [
  "https://www.espn.com/espn/rss/news",
  "https://feeds.bbci.co.uk/sport/rss.xml"
];

const ALL_FEEDS = [...MOROCCAN_FEEDS, ...GLOBAL_FEEDS];

const USERNAME = "Rabii El Baghdadi";
const BADGE = "AI";
const HISTORY_COLLECTION = "ai_autopost_history";
const POSTS_COLLECTION = "posts";

const DEFAULT_TIMEZONE = process.env.AUTOPOST_TIMEZONE || "Africa/Casablanca";
const REQUIRE_IMAGE = (process.env.AUTOPOST_REQUIRE_IMAGE || "true").toLowerCase() !== "false";
const MOROCCAN_TARGET_PER_DAY = Number(process.env.AUTOPOST_MOROCCAN_TARGET_PER_DAY || 3);
const DAILY_TARGET = Number(process.env.AUTOPOST_DAILY_TARGET || 5);

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(text = "") {
  return String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFingerprint(item) {
  return normalizeText(item.title || "").slice(0, 180);
}

function isMoroccanStory(item) {
  const text = normalizeText(
    `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""} ${item.link || ""}`
  );

  const signals = [
    "morocco",
    "moroccan",
    "maroc",
    "botola",
    "atlas lions",
    "atlas lion",
    "frmf",
    "casablanca",
    "rabat",
    "wydad",
    "raja",
    "far rabat",
    "renaissance berkane",
    "berkane",
    "nahdat berkane",
    "futsal morocco",
    "hakimi",
    "el kaabi",
    "ounahi",
    "ziyech",
    "en nesyri",
    "yassine bono",
    "bono"
  ];

  return signals.some(s => text.includes(s));
}

function detectCategory(item) {
  const text = normalizeText(
    `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""}`
  );

  if (
    text.includes("tennis") ||
    text.includes("atp") ||
    text.includes("wta") ||
    text.includes("grand slam")
  ) return "tennis";

  if (
    text.includes("basketball") ||
    text.includes("nba") ||
    text.includes("euroleague") ||
    text.includes("fiba")
  ) return "basketball";

  if (
    text.includes("esport") ||
    text.includes("esports") ||
    text.includes("gaming") ||
    text.includes("fifa") ||
    text.includes("ea fc")
  ) return "esports";

  return "football";
}

function buildHashtags(item) {
  const tags = ["#sports"];
  const category = detectCategory(item);

  if (category === "football") tags.push("#football");
  if (category === "basketball") tags.push("#basketball");
  if (category === "tennis") tags.push("#tennis");
  if (category === "esports") tags.push("#esports");

  if (isMoroccanStory(item)) {
    tags.push("#morocco");
    if (category === "football") tags.push("#botola");
  } else {
    tags.push("#global");
  }

  return tags.join(" ");
}

function chooseLead(item) {
  const title = stripHtml(item.title || "").trim();
  const summary = stripHtml(item.contentSnippet || item.content || item.contentEncoded || "").trim();

  const lower = normalizeText(`${title} ${summary}`);

  if (lower.includes("wins") || lower.includes("beat") || lower.includes("victory")) {
    return "Big result just landed.";
  }
  if (lower.includes("injury") || lower.includes("ruled out") || lower.includes("doubt")) {
    return "Important team news is in.";
  }
  if (lower.includes("transfer") || lower.includes("sign") || lower.includes("deal")) {
    return "Transfer movement is picking up.";
  }
  if (lower.includes("final") || lower.includes("semi final") || lower.includes("quarter final")) {
    return "This one could shape the bigger picture.";
  }
  if (isMoroccanStory(item)) {
    return "Fresh Moroccan sports update.";
  }

  return "Fresh sports update.";
}

function buildHumanRewrite(item) {
  const title = stripHtml(item.title || "Sports update").trim();
  const rawSummary = stripHtml(item.contentSnippet || item.content || item.contentEncoded || "").trim();

  let summary = rawSummary;
  if (summary.length > 220) {
    summary = `${summary.slice(0, 217).trim()}...`;
  }

  const lead = chooseLead(item);
  const hashtags = buildHashtags(item);

  const blocks = [
    lead,
    "",
    title,
    "",
    summary || "More details are emerging from the latest sports coverage.",
    "",
    hashtags
  ];

  return blocks.join("\n");
}

function getImageFromMediaContent(mediaContent) {
  if (!Array.isArray(mediaContent)) return "";

  for (const item of mediaContent) {
    const url = item?.$?.url || item?.url || "";
    const medium = String(item?.medium || item?.$?.medium || "").toLowerCase();
    const type = String(item?.type || item?.$?.type || "").toLowerCase();

    if (!url) continue;
    if (medium === "image" || type.startsWith("image/") || (!medium && !type)) {
      return url;
    }
  }

  return "";
}

function pickImageUrl(item) {
  if (item?.enclosure?.url) {
    const type = String(item.enclosure.type || "").toLowerCase();
    if (!type || type.startsWith("image/")) {
      return item.enclosure.url;
    }
  }

  const mediaContentUrl = getImageFromMediaContent(item.mediaContent);
  if (mediaContentUrl) return mediaContentUrl;

  if (Array.isArray(item.mediaThumbnail) && item.mediaThumbnail.length) {
    const thumb = item.mediaThumbnail[0];
    const thumbUrl = thumb?.$?.url || thumb?.url || "";
    if (thumbUrl) return thumbUrl;
  }

  const htmlCandidates = [
    item.contentEncoded,
    item.content,
    item.summary,
    item.contentSnippet
  ].filter(Boolean);

  for (const html of htmlCandidates) {
    const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match?.[1]) return match[1];
  }

  return "";
}

function scoreItem(item, sourceCountMap, moroccanTodayCount) {
  const published = new Date(item.isoDate || item.pubDate || Date.now()).getTime();
  const ageHours = Math.max((Date.now() - published) / (1000 * 60 * 60), 0);
  const recencyScore = Math.max(0, 48 - ageHours);

  const fingerprint = buildFingerprint(item);
  const overlapScore = (sourceCountMap.get(fingerprint) || 1) * 12;

  const moroccanBoost = isMoroccanStory(item)
    ? (moroccanTodayCount < MOROCCAN_TARGET_PER_DAY ? 26 : 12)
    : 4;

  const imageBoost = pickImageUrl(item) ? 10 : -12;

  const category = detectCategory(item);
  const categoryBoost =
    category === "football" ? 8 :
    category === "basketball" ? 4 :
    category === "tennis" ? 3 : 2;

  return recencyScore + overlapScore + moroccanBoost + imageBoost + categoryBoost;
}

async function fetchFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    const items = Array.isArray(feed.items) ? feed.items : [];
    return items.slice(0, 25).map(item => ({
      ...item,
      _feedUrl: url,
      _isMoroccanFeed: MOROCCAN_FEEDS.includes(url)
    }));
  } catch (err) {
    console.error("Feed error:", url, err.message);
    return [];
  }
}

async function fetchAllNews() {
  const results = await Promise.all(ALL_FEEDS.map(fetchFeed));
  return results.flat();
}

async function alreadyPosted(db, fingerprint) {
  const snap = await db.collection(HISTORY_COLLECTION)
    .where("fingerprint", "==", fingerprint)
    .limit(1)
    .get();

  return !snap.empty;
}

async function markAsPosted(db, item, fingerprint) {
  await db.collection(HISTORY_COLLECTION).add({
    title: item.title || "",
    link: item.link || "",
    fingerprint,
    isMoroccan: isMoroccanStory(item),
    category: detectCategory(item),
    hasImage: !!pickImageUrl(item),
    createdAt: new Date()
  });
}

async function getTodayAutopostStats(db) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const snap = await db.collection(HISTORY_COLLECTION)
    .where("createdAt", ">=", start)
    .get();

  let total = 0;
  let moroccan = 0;

  snap.forEach(doc => {
    total += 1;
    const data = doc.data() || {};
    if (data.isMoroccan) moroccan += 1;
  });

  return { total, moroccan };
}

async function createPost(db, item) {
  const avatar = process.env.AI_AUTOPOST_AVATAR_URL || "";
  const mediaUrl = pickImageUrl(item);
  const content = buildHumanRewrite(item);

  const post = {
    username: USERNAME,
    badge: BADGE,
    avatarUrl: avatar,
    content,
    mediaUrl: mediaUrl || "",
    mediaType: mediaUrl ? "image" : "",
    likes: 0,
    hearts: 0,
    fires: 0,
    pinned: false,
    score: 0,
    createdAt: new Date()
  };

  await db.collection(POSTS_COLLECTION).add(post);
}

async function pickBestCandidate(db) {
  const allNews = await fetchAllNews();

  if (!allNews.length) {
    throw new Error("No feed items found.");
  }

  const todayStats = await getTodayAutopostStats(db);

  const sourceCountMap = new Map();
  for (const item of allNews) {
    const fp = buildFingerprint(item);
    sourceCountMap.set(fp, (sourceCountMap.get(fp) || 0) + 1);
  }

  const ranked = allNews
    .filter(item => item.title && item.link)
    .filter(item => {
      if (!REQUIRE_IMAGE) return true;
      return !!pickImageUrl(item);
    })
    .sort((a, b) => scoreItem(b, sourceCountMap, todayStats.moroccan) - scoreItem(a, sourceCountMap, todayStats.moroccan));

  for (const item of ranked) {
    const fingerprint = buildFingerprint(item);
    const exists = await alreadyPosted(db, fingerprint);
    if (!exists) {
      return item;
    }
  }

  return null;
}

async function runAutoPost(db) {
  console.log("🧠 Running upgraded AI auto-post...");

  const todayStats = await getTodayAutopostStats(db);
  if (todayStats.total >= DAILY_TARGET) {
    return {
      ok: true,
      skipped: true,
      reason: "Daily target already reached."
    };
  }

  const item = await pickBestCandidate(db);

  if (!item) {
    return {
      ok: true,
      skipped: true,
      reason: "No fresh unique story found."
    };
  }

  const fingerprint = buildFingerprint(item);
  await createPost(db, item);
  await markAsPosted(db, item, fingerprint);

  console.log("✅ Posted:", item.title);

  return {
    ok: true,
    title: item.title,
    isMoroccan: isMoroccanStory(item),
    category: detectCategory(item),
    hasImage: !!pickImageUrl(item)
  };
}

function startAiAutoPostSystem({ db }) {
  console.log("🚀 AI AutoPost system started");

  cron.schedule(
    "0 9,12,15,18,21 * * *",
    async () => {
      try {
        await runAutoPost(db);
      } catch (err) {
        console.error("AutoPost error:", err);
      }
    },
    { timezone: DEFAULT_TIMEZONE }
  );
}

module.exports = {
  startAiAutoPostSystem,
  runAutoPost
};
