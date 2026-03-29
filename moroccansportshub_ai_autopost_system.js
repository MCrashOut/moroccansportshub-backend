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
const POSTS_COLLECTION = "posts";
const HISTORY_COLLECTION = "ai_autopost_history";
const STATE_COLLECTION = "system_state";
const STATE_DOC_ID = "autopost";

const DEFAULT_TIMEZONE = process.env.AUTOPOST_TIMEZONE || "Africa/Casablanca";
const REQUIRE_IMAGE = (process.env.AUTOPOST_REQUIRE_IMAGE || "true").toLowerCase() !== "false";
const DAILY_TARGET = Number(process.env.AUTOPOST_DAILY_TARGET || 5);
const MOROCCAN_TARGET_PER_DAY = Number(process.env.AUTOPOST_MOROCCAN_TARGET_PER_DAY || 3);

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
    `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""} ${item.contentEncoded || ""} ${item.link || ""}`
  );

  const signals = [
    "morocco", "moroccan", "maroc", "botola", "frmf", "atlas lions",
    "atlas lion", "casablanca", "rabat", "wydad", "raja", "far rabat",
    "berkane", "nahdat berkane", "renaissance berkane", "hakimi",
    "ziyech", "ounahi", "en nesyri", "el kaabi", "bono", "moroccan football",
    "moroccan league", "moroccan national team"
  ];

  return signals.some(s => text.includes(s));
}

function detectCategory(item) {
  const text = normalizeText(
    `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""} ${item.contentEncoded || ""}`
  );

  if (
    text.includes("basketball") ||
    text.includes("nba") ||
    text.includes("euroleague") ||
    text.includes("fiba")
  ) return "basketball";

  if (
    text.includes("tennis") ||
    text.includes("atp") ||
    text.includes("wta") ||
    text.includes("grand slam")
  ) return "tennis";

  if (
    text.includes("esports") ||
    text.includes("esport") ||
    text.includes("gaming") ||
    text.includes("ea fc") ||
    text.includes("fifa ")
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

function humanLead(item) {
  const text = normalizeText(`${item.title || ""} ${item.contentSnippet || ""}`);

  if (isMoroccanStory(item) && detectCategory(item) === "football") {
    return "Moroccan football is back in focus.";
  }
  if (text.includes("win") || text.includes("victory") || text.includes("beat")) {
    return "Big result coming through.";
  }
  if (text.includes("injury") || text.includes("ruled out") || text.includes("doubt")) {
    return "Important team news just dropped.";
  }
  if (text.includes("transfer") || text.includes("sign") || text.includes("deal")) {
    return "Transfer movement is heating up.";
  }
  if (text.includes("final") || text.includes("semi final") || text.includes("quarter final")) {
    return "A major step in the competition is taking shape.";
  }
  if (isMoroccanStory(item)) {
    return "Fresh update from Moroccan sport.";
  }
  return "Fresh update from the sports world.";
}

function buildHumanStylePost(item) {
  const title = stripHtml(item.title || "Sports update").trim();
  let summary = stripHtml(item.contentSnippet || item.content || item.contentEncoded || "").trim();

  if (summary.length > 240) {
    summary = `${summary.slice(0, 237).trim()}...`;
  }

  if (!summary) {
    summary = "More details are now emerging around this story.";
  }

  const category = detectCategory(item);
  const lead = humanLead(item);
  const hashtags = buildHashtags(item);

  let angle = "";
  if (isMoroccanStory(item)) {
    angle =
      category === "football"
        ? "This is one to watch closely for Moroccan football fans."
        : "This matters for Morocco’s wider sports scene too.";
  } else {
    angle = "This one is worth watching as it develops.";
  }

  return [
    lead,
    "",
    title,
    "",
    summary,
    "",
    angle,
    "",
    hashtags
  ].join("\n");
}

function pickImageFromMediaContent(mediaContent) {
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

  const mediaContentUrl = pickImageFromMediaContent(item.mediaContent);
  if (mediaContentUrl) return mediaContentUrl;

  if (Array.isArray(item.mediaThumbnail) && item.mediaThumbnail.length) {
    const thumb = item.mediaThumbnail[0];
    const url = thumb?.$?.url || thumb?.url || "";
    if (url) return url;
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

function publishedTime(item) {
  return new Date(item.isoDate || item.pubDate || Date.now()).getTime();
}

function scoreItem(item, sourceCountMap, moroccanTodayCount) {
  const ageHours = Math.max((Date.now() - publishedTime(item)) / (1000 * 60 * 60), 0);
  const recencyScore = Math.max(0, 48 - ageHours);
  const overlapScore = (sourceCountMap.get(buildFingerprint(item)) || 1) * 12;
  const imageScore = pickImageUrl(item) ? 12 : -15;
  const categoryScore =
    detectCategory(item) === "football" ? 9 :
    detectCategory(item) === "basketball" ? 4 :
    detectCategory(item) === "tennis" ? 4 : 3;

  let moroccanScore = 0;
  if (isMoroccanStory(item)) {
    moroccanScore = moroccanTodayCount < MOROCCAN_TARGET_PER_DAY ? 30 : 14;
  } else {
    moroccanScore = 4;
  }

  return recencyScore + overlapScore + imageScore + categoryScore + moroccanScore;
}

async function fetchFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    const items = Array.isArray(feed.items) ? feed.items : [];
    return items.slice(0, 25).map(item => ({
      ...item,
      _feedUrl: url
    }));
  } catch (err) {
    console.error("Feed error:", url, err.message);
    return [];
  }
}

async function fetchAllNews() {
  const lists = await Promise.all(ALL_FEEDS.map(fetchFeed));
  return lists.flat();
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

async function getTodayStats(db) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const snap = await db.collection(HISTORY_COLLECTION)
    .where("createdAt", ">=", start)
    .get();

  let total = 0;
  let moroccan = 0;

  snap.forEach(doc => {
    const data = doc.data() || {};
    total += 1;
    if (data.isMoroccan) moroccan += 1;
  });

  return { total, moroccan };
}

async function getSystemState(db) {
  const ref = db.collection(STATE_COLLECTION).doc(STATE_DOC_ID);
  const snap = await ref.get();

  if (!snap.exists) {
    return { paused: false };
  }

  return snap.data() || { paused: false };
}

async function setPaused(db, paused) {
  const ref = db.collection(STATE_COLLECTION).doc(STATE_DOC_ID);
  await ref.set(
    {
      paused: !!paused,
      updatedAt: new Date()
    },
    { merge: true }
  );

  return { paused: !!paused };
}

async function getRecentAutoPosts(db, limit = 10) {
  const snap = await db.collection(POSTS_COLLECTION)
    .where("badge", "==", BADGE)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

async function postToBufferChannels(text) {
  const apiKey = process.env.BUFFER_API_KEY;
  const channelIds = [
    process.env.BUFFER_FACEBOOK_CHANNEL_ID,
    process.env.BUFFER_TWITTER_CHANNEL_ID
  ].filter(Boolean);

  if (!apiKey || channelIds.length === 0) {
    console.log("⚠️ Buffer not configured. Skipping social posting.");
    return;
  }

  for (const channelId of channelIds) {
    try {
      const response = await fetch("https://api.buffer.com", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: `
            mutation CreatePost($input: CreatePostInput!) {
              createPost(input: $input) {
                ... on PostActionSuccess {
                  post {
                    id
                    status
                    channelId
                  }
                }
                ... on InvalidInputError {
                  message
                }
                ... on UnauthorizedError {
                  message
                }
                ... on UnexpectedError {
                  message
                }
                ... on RestProxyError {
                  message
                }
                ... on LimitReachedError {
                  message
                }
                ... on NotFoundError {
                  message
                }
              }
            }
          `,
          variables: {
            input: {
              channelId,
              text,
              schedulingType: "automatic",
              mode: "shareNow"
            }
          }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Buffer HTTP error:", response.status, data);
        continue;
      }

      if (data.errors?.length) {
        console.error("Buffer GraphQL errors:", data.errors);
        continue;
      }

      const result = data?.data?.createPost;

      if (result?.message) {
        console.error(`Buffer post failed for ${channelId}:`, result.message);
        continue;
      }

      console.log(`📤 Buffer post sent for channel ${channelId}:`, result?.post?.id || "ok");
    } catch (err) {
      console.error(`❌ Buffer error for channel ${channelId}:`, err.message);
    }
  }
}

function buildBufferCaption(post) {
  const raw = post?.content || "";
  const cleaned = String(raw).trim();

  if (!cleaned) return null;

  const maxLen = 260;
  const shortText =
    cleaned.length > maxLen
      ? cleaned.slice(0, maxLen - 3).trim() + "..."
      : cleaned;

  return `${shortText}\n\n🌐 moroccansportshub.com`;
}

async function createPost(db, item) {
  const avatar = process.env.AI_AUTOPOST_AVATAR_URL || "";
  const mediaUrl = pickImageUrl(item);

  const post = {
    username: USERNAME,
    badge: BADGE,
    avatarUrl: avatar,
    content: buildHumanStylePost(item),
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

  const socialCaption = buildBufferCaption(post);
  if (socialCaption) {
    await postToBufferChannels(socialCaption);
  }
}

async function pickBestCandidate(db) {
  const allNews = await fetchAllNews();

  if (!allNews.length) {
    throw new Error("No feed items found.");
  }

  const todayStats = await getTodayStats(db);

  const sourceCountMap = new Map();
  for (const item of allNews) {
    const key = buildFingerprint(item);
    sourceCountMap.set(key, (sourceCountMap.get(key) || 0) + 1);
  }

  const ranked = allNews
    .filter(item => item.title && item.link)
    .filter(item => REQUIRE_IMAGE ? !!pickImageUrl(item) : true)
    .sort((a, b) => scoreItem(b, sourceCountMap, todayStats.moroccan) - scoreItem(a, sourceCountMap, todayStats.moroccan));

  for (const item of ranked) {
    const fingerprint = buildFingerprint(item);
    const exists = await alreadyPosted(db, fingerprint);
    if (!exists) return item;
  }

  return null;
}

async function runAutoPost(db) {
  const state = await getSystemState(db);
  if (state.paused) {
    return { ok: true, skipped: true, reason: "Autopost is paused." };
  }

  const todayStats = await getTodayStats(db);
  if (todayStats.total >= DAILY_TARGET) {
    return { ok: true, skipped: true, reason: "Daily target already reached." };
  }

  const item = await pickBestCandidate(db);
  if (!item) {
    return { ok: true, skipped: true, reason: "No fresh unique story found." };
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
        const result = await runAutoPost(db);
        console.log("Autopost result:", result);
      } catch (err) {
        console.error("AutoPost error:", err);
      }
    },
    { timezone: DEFAULT_TIMEZONE }
  );
}

module.exports = {
  startAiAutoPostSystem,
  runAutoPost,
  setPaused,
  getSystemState,
  getTodayStats,
  getRecentAutoPosts
};
