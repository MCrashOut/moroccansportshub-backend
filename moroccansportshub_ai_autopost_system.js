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

const DEFAULT_TIMEZONE = "Africa/Casablanca";

/* ------------------- HELPERS ------------------- */

function stripHtml(text = "") {
  return String(text).replace(/<[^>]*>/g, "").trim();
}

function normalize(text = "") {
  return String(text).toLowerCase();
}

function isMoroccanStory(item) {
  const t = normalize(item.title + " " + item.contentSnippet);
  return t.includes("morocco") || t.includes("maroc") || t.includes("المغرب");
}

function detectCategory(item) {
  const t = normalize(item.title + " " + item.contentSnippet);
  if (t.includes("basket")) return "basketball";
  if (t.includes("tennis")) return "tennis";
  return "football";
}

/* ------------------- LANGUAGE ------------------- */

function getLang(item) {
  if (/[ء-ي]/.test(item.title)) return "ar";
  if (isMoroccanStory(item)) return "fr";
  return "en";
}

/* ------------------- HASHTAGS ------------------- */

function getHashtags(item, lang) {
  const cat = detectCategory(item);

  if (lang === "ar") {
    return "#رياضة #المغرب #كرة_القدم";
  }

  if (lang === "fr") {
    return "#sport #maroc #football";
  }

  return "#sports #football #news";
}

/* ------------------- CAPTION ------------------- */

function buildCaption(item) {
  const lang = getLang(item);
  const title = stripHtml(item.title);
  let summary = stripHtml(item.contentSnippet || "");

  summary = summary.slice(0, 140);

  if (lang === "ar") {
    return `🔥 خبر جديد\n\n${title}\n\n${summary}`;
  }

  if (lang === "fr") {
    return `🔥 Nouvelle actu\n\n${title}\n\n${summary}`;
  }

  return `🔥 Breaking news\n\n${title}\n\n${summary}`;
}

/* ------------------- IMAGE ------------------- */

function getImage(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item.mediaContent?.[0]?.url) return item.mediaContent[0].url;
  return "";
}

/* ------------------- BUFFER ------------------- */

async function postToBuffer(post) {
  const apiKey = process.env.BUFFER_API_KEY;

  const channels = [
    { id: process.env.BUFFER_FACEBOOK_CHANNEL_ID, type: "facebook" },
    { id: process.env.BUFFER_TWITTER_CHANNEL_ID, type: "twitter" }
  ];

  const results = [];

  for (const ch of channels) {
    if (!ch.id) continue;

    let text = post.content;
    let hashtags = getHashtags(post.rawItem, post.lang);

    if (ch.type === "twitter") {
      text = text.replace(/\n/g, " ").slice(0, 200);
      hashtags = hashtags.split(" ").slice(0, 2).join(" ");
      text = `${text} ${hashtags} 🌐 moroccansportshub.com`;
    } else {
      text = `${text}\n\n${hashtags}\n\n🌐 moroccansportshub.com`;
    }

    const body = {
      query: `
        mutation {
          createPost(input:{
            channelId:"${ch.id}"
            text:"${text.replace(/"/g, '\\"')}"
            mode:shareNow
            ${ch.type === "facebook" ? 'metadata:{facebook:{type:"post"}}' : ""}
          }){
            ... on PostActionSuccess {
              post { id status }
            }
            ... on InvalidInputError {
              message
            }
          }
        }
      `
    };

    const res = await fetch("https://api.buffer.com", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    results.push({
      channel: ch.type,
      ok: !data?.data?.createPost?.message,
      data
    });
  }

  return results;
}

/* ------------------- MAIN ------------------- */

async function fetchNews() {
  const feeds = await Promise.all(ALL_FEEDS.map(url => parser.parseURL(url)));
  return feeds.flatMap(f => f.items || []);
}

async function createPost(db, item) {
  const lang = getLang(item);

  const post = {
    username: USERNAME,
    badge: BADGE,
    content: buildCaption(item),
    mediaUrl: getImage(item),
    createdAt: new Date(),
    rawItem: item,
    lang
  };

  await db.collection(POSTS_COLLECTION).add(post);

  const bufferResults = await postToBuffer(post);

  return bufferResults;
}

async function runAutoPost(db) {
  const news = await fetchNews();
  const item = news[Math.floor(Math.random() * news.length)];

  const bufferResults = await createPost(db, item);

  return {
    ok: true,
    title: item.title,
    bufferResults
  };
}

/* ------------------- CRON ------------------- */

function startAiAutoPostSystem({ db }) {
  console.log("AutoPost started");

  cron.schedule(
    "0 12,15,18,21,23 * * *",
    async () => {
      try {
        await runAutoPost(db);
      } catch (e) {
        console.log("error", e);
      }
    },
    { timezone: DEFAULT_TIMEZONE }
  );
}

module.exports = {
  startAiAutoPostSystem,
  runAutoPost
};
