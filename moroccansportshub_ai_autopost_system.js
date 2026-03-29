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
    "moroccan league", "moroccan national team", "المغرب", "المنتخب المغربي",
    "الأسود", "الرجاء", "الوداد", "البطولة", "المغربية"
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

function hasArabic(text = "") {
  return /[\u0600-\u06FF]/.test(String(text));
}

function getStoryText(item) {
  return stripHtml(
    `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""} ${item.contentEncoded || ""}`
  ).trim();
}

function getPostLanguage(item) {
  const text = getStoryText(item);
  const feedUrl = String(item._feedUrl || "").toLowerCase();

  if (hasArabic(text)) return "ar";

  if (isMoroccanStory(item)) {
    if (feedUrl.includes("le360") || feedUrl.includes("hespress")) return "fr";
    return "fr";
  }

  return "en";
}

function buildHashtags(item, lang = "en") {
  const category = detectCategory(item);

  if (lang === "ar") {
    const tags = ["#رياضة"];
    if (category === "football") tags.push("#كرة_القدم");
    if (category === "basketball") tags.push("#كرة_السلة");
    if (category === "tennis") tags.push("#تنس");
    if (category === "esports") tags.push("#رياضات_إلكترونية");

    if (isMoroccanStory(item)) {
      tags.push("#المغرب");
      if (category === "football") tags.push("#البطولة");
    } else {
      tags.push("#رياضة_عالمية");
    }

    return tags.join(" ");
  }

  if (lang === "fr") {
    const tags = ["#sport"];
    if (category === "football") tags.push("#football");
    if (category === "basketball") tags.push("#basketball");
    if (category === "tennis") tags.push("#tennis");
    if (category === "esports") tags.push("#esport");

    if (isMoroccanStory(item)) {
      tags.push("#maroc");
      if (category === "football") tags.push("#botola");
    } else {
      tags.push("#sportmondial");
    }

    return tags.join(" ");
  }

  const tags = ["#sports"];
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

function humanLead(item, lang = "en") {
  const text = normalizeText(`${item.title || ""} ${item.contentSnippet || ""}`);
  const moroccan = isMoroccanStory(item);
  const category = detectCategory(item);

  if (lang === "ar") {
    if (moroccan && category === "football") return "خبر مهم لعشاق الكرة المغربية 🔥";
    if (text.includes("win") || text.includes("victory") || text.includes("beat")) return "فوز مهم خطف الأنظار 👀";
    if (text.includes("injury") || text.includes("ruled out") || text.includes("doubt")) return "مستجد مهم قبل المواجهة 🚨";
    if (text.includes("transfer") || text.includes("sign") || text.includes("deal")) return "سوق الانتقالات يشتعل من جديد 💥";
    if (text.includes("final") || text.includes("semi final") || text.includes("quarter final")) return "المنافسة تدخل مرحلة حاسمة ⚔️";
    if (moroccan) return "آخر تطورات الرياضة المغربية 🇲🇦";
    return "جديد الساحة الرياضية 🌍";
  }

  if (lang === "fr") {
    if (moroccan && category === "football") return "Grosse actu pour les fans du football marocain 🔥";
    if (text.includes("win") || text.includes("victory") || text.includes("beat")) return "Résultat marquant à retenir 👀";
    if (text.includes("injury") || text.includes("ruled out") || text.includes("doubt")) return "Info importante avant le match 🚨";
    if (text.includes("transfer") || text.includes("sign") || text.includes("deal")) return "Le mercato commence à bouger 💥";
    if (text.includes("final") || text.includes("semi final") || text.includes("quarter final")) return "La compétition entre dans le dur ⚔️";
    if (moroccan) return "Nouvelle actu du sport marocain 🇲🇦";
    return "Nouvelle info à suivre dans le monde du sport 🌍";
  }

  if (moroccan && category === "football") return "Big update for Moroccan football fans 🔥";
  if (text.includes("win") || text.includes("victory") || text.includes("beat")) return "Big result just landed 👀";
  if (text.includes("injury") || text.includes("ruled out") || text.includes("doubt")) return "Important team news just dropped 🚨";
  if (text.includes("transfer") || text.includes("sign") || text.includes("deal")) return "Transfer talk is heating up 💥";
  if (text.includes("final") || text.includes("semi final") || text.includes("quarter final")) return "This competition is getting serious ⚔️";
  if (moroccan) return "Fresh update from Moroccan sport 🇲🇦";
  return "Fresh update from the sports world 🌍";
}

function buildAngle(item, lang = "en") {
  const moroccan = isMoroccanStory(item);
  const category = detectCategory(item);

  if (lang === "ar") {
    if (moroccan) {
      return category === "football"
        ? "هذا الخبر يستحق متابعة خاصة من الجماهير المغربية."
        : "تطور مهم يخص الساحة الرياضية المغربية.";
    }
    return "ملف يستحق المتابعة في الساعات القادمة.";
  }

  if (lang === "fr") {
    if (moroccan) {
      return category === "football"
        ? "Un dossier à suivre de près pour les supporters marocains."
        : "Une évolution importante pour le sport marocain.";
    }
    return "Une info à surveiller dans les prochaines heures.";
  }

  if (moroccan) {
    return category === "football"
      ? "One to watch closely for Moroccan football fans."
      : "This matters for Morocco’s wider sports scene too.";
  }

  return "Worth watching as the story develops.";
}

function buildHumanStylePost(item) {
  const lang = getPostLanguage(item);
  const title = stripHtml(item.title || "Sports update").trim();
  let summary = stripHtml(item.contentSnippet || item.content || item.contentEncoded || "").trim();

  if (lang === "ar") {
    if (summary.length > 170) summary = `${summary.slice(0, 167).trim()}...`;
    if (!summary) summary = "التفاصيل تتضح أكثر حول هذا الخبر.";

    return [
      humanLead(item, lang),
      "",
      title,
      "",
      summary,
      "",
      buildAngle(item, lang),
      "",
      buildHashtags(item, lang)
    ].join("\n");
  }

  if (lang === "fr") {
    if (summary.length > 170) summary = `${summary.slice(0, 167).trim()}...`;
    if (!summary) summary = "De nouveaux détails émergent autour de cette actualité.";

    return [
      humanLead(item, lang),
      "",
      title,
      "",
      summary,
      "",
      buildAngle(item, lang),
      "",
      buildHashtags(item, lang)
    ].join("\n");
  }

  if (summary.length > 170) summary = `${summary.slice(0, 167).trim()}...`;
  if (!summary) summary = "More details are emerging around this story.";

  return [
    humanLead(item, lang),
    "",
    title,
    "",
    summary,
    "",
    buildAngle(item, lang),
    "",
    buildHashtags(item, lang)
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

function buildFacebookCaption(post) {
  const raw = String(post?.content || "").trim();
  if (!raw) return "🌐 moroccansportshub.com";
  return `${raw}\n\n🌐 moroccansportshub.com`;
}

function buildTwitterCaption(post) {
  const content = String(post?.content || "").trim();
  const lines = content.split("\n").map(x => x.trim()).filter(Boolean);

  const hook = lines[0] || "";
  const title = lines[1] || "";
  const hashtags = lines[lines.length - 1] || "";
  const suffix = " 🌐 moroccansportshub.com";

  const keptTags = hashtags
    .split(/\s+/)
    .filter(tag => tag.startsWith("#"))
    .slice(0, 2)
    .join(" ");

  let body = [hook, title].filter(Boolean).join(" ");
  body = body.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  const reserved = `${keptTags ? " " + keptTags : ""}${suffix}`;
  const maxBody = 280 - reserved.length - 1;

  if (body.length > maxBody) {
    body = body.slice(0, Math.max(maxBody - 3, 40)).trim() + "...";
  }

  return `${body}${keptTags ? " " + keptTags : ""}${suffix}`.trim();
}

async function postToBufferChannels(post) {
  const apiKey = process.env.BUFFER_API_KEY;

  const channels = [
    {
      channelId: process.env.BUFFER_FACEBOOK_CHANNEL_ID,
      platform: "facebook"
    },
    {
      channelId: process.env.BUFFER_TWITTER_CHANNEL_ID,
      platform: "twitter"
    }
  ].filter(x => x.channelId);

  if (!apiKey || channels.length === 0) {
    return [{ ok: false, error: "Buffer not configured" }];
  }

  const results = [];

  for (const channel of channels) {
    try {
      const text =
        channel.platform === "twitter"
          ? buildTwitterCaption(post)
          : buildFacebookCaption(post);

      const input = {
        channelId: channel.channelId,
        text,
        schedulingType: "automatic",
        mode: "shareNow"
      };

      if (channel.platform === "facebook") {
        input.metadata = {
          facebook: {
            type: "post"
          }
        };
      }

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
          variables: { input }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        results.push({
          ok: false,
          channelId: channel.channelId,
          platform: channel.platform,
          httpStatus: response.status,
          data
        });
        continue;
      }

      if (data.errors?.length) {
        results.push({
          ok: false,
          channelId: channel.channelId,
          platform: channel.platform,
          graphqlErrors: data.errors
        });
        continue;
      }

      const result = data?.data?.createPost;

      if (result?.message) {
        results.push({
          ok: false,
          channelId: channel.channelId,
          platform: channel.platform,
          message: result.message
        });
        continue;
      }

      results.push({
        ok: true,
        channelId: channel.channelId,
        platform: channel.platform,
        post: result?.post || null
      });
    } catch (err) {
      results.push({
        ok: false,
        channelId: channel.channelId,
        platform: channel.platform,
        error: err.message
      });
    }
  }

  return results;
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

  const socialPost = {
    ...post,
    rawItem: item
  };

  let bufferResults = [];
  bufferResults = await postToBufferChannels(socialPost);

  return { post, bufferResults };
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

  const created = await createPost(db, item);
  await markAsPosted(db, item, fingerprint);

  console.log("✅ Posted:", item.title);

  return {
    ok: true,
    title: item.title,
    isMoroccan: isMoroccanStory(item),
    category: detectCategory(item),
    hasImage: !!pickImageUrl(item),
    bufferResults: created?.bufferResults || []
  };
}

async function forceAutoPostNow(db) {
  const item = await pickBestCandidate(db);

  if (!item) {
    return { ok: true, skipped: true, reason: "No fresh unique story found." };
  }

  const fingerprint = buildFingerprint(item);

  const created = await createPost(db, item);
  await markAsPosted(db, item, fingerprint);

  return {
    ok: true,
    forced: true,
    title: item.title,
    isMoroccan: isMoroccanStory(item),
    category: detectCategory(item),
    hasImage: !!pickImageUrl(item),
    bufferResults: created?.bufferResults || []
  };
}

function startAiAutoPostSystem({ db }) {
  console.log("🚀 AI AutoPost system started");

  cron.schedule(
    "0 12,15,18,21,23 * * *",
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
  forceAutoPostNow,
  setPaused,
  getSystemState,
  getTodayStats,
  getRecentAutoPosts
};
