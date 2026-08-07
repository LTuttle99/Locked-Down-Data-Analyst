const VANESSA_LEVELS = ["offline", "ask", "structure", "aggregate", "sample"];

const VANESSA_LEVEL_LABELS = {
  offline: "Built-in help only",
  ask: "My questions",
  structure: "Column names and types",
  aggregate: "Summary statistics",
  sample: "Sample rows"
};

const VANESSA_LEVEL_BLURBS = {
  offline: "Vanessa answers from a built-in help index. Nothing leaves this browser tab at all.",
  ask: "Your typed question leaves this tab and goes to a language model running on this computer. No part of your file is included.",
  structure: "Also includes your column names, their detected types, and the row and column counts. No cell values.",
  aggregate: "Also includes summary statistics such as min, max, mean, median, blanks and distinct counts, plus the actual labels of columns that have 25 or fewer distinct values. No raw records.",
  sample: "Also includes up to five real rows from your file, with actual cell values."
};

const VANESSA_LABEL_MAX = 25;
const VANESSA_SAMPLE_ROWS = 5;
const VANESSA_CELL_MAX = 80;
const VANESSA_BACKEND_URL = "http://127.0.0.1:11434";
const VANESSA_PROBE_MS = 1200;

let vanessaTool = null;
let vanessaGetDataset = null;
let vanessaLevel = "offline";
let vanessaBackend = { available: false, model: null };
let vanessaHistory = [];
let vanessaBusy = false;
let vanessaStarted = false;

function vanessaLevelIndex(level) {
  const index = VANESSA_LEVELS.indexOf(level);
  return index === -1 ? 0 : index;
}

function vanessaAtLeast(level) {
  return vanessaLevelIndex(vanessaLevel) >= vanessaLevelIndex(level);
}

function vanessaTokenize(text) {
  return String(text === null || text === undefined ? "" : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1);
}

function vanessaScoreTopic(tokens, topic) {
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const keyword of topic.keywords) {
    const parts = vanessaTokenize(keyword);
    if (parts.length === 0) continue;
    const hit = parts.every((p) => tokens.some((t) => t === p || (t.length > 3 && p.length > 3 && (t.startsWith(p) || p.startsWith(t)))));
    if (hit) score += parts.length > 1 ? 3 : 2;
  }
  return score;
}

function vanessaKnowledgeFor(toolId) {
  if (typeof VANESSA_KNOWLEDGE === "undefined") return null;
  return VANESSA_KNOWLEDGE[toolId] || null;
}

function vanessaFindTopics(toolId, question, limit = 3) {
  const tokens = vanessaTokenize(question);
  const entry = vanessaKnowledgeFor(toolId);
  const shared = typeof VANESSA_SHARED_TOPICS === "undefined" ? [] : VANESSA_SHARED_TOPICS;
  const pool = (entry ? entry.topics : []).map((t) => ({ topic: t, boost: 3 })).concat(shared.map((t) => ({ topic: t, boost: 0 })));

  const scored = pool
    .map((item) => {
      const raw = vanessaScoreTopic(tokens, item.topic);
      return { text: item.topic.text, score: raw === 0 ? 0 : raw + item.boost };
    })
    .filter((item) => item.score > 1)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((item) => item.text);
}

const VANESSA_SMALLTALK = [
  {
    keywords: ["hi", "hello", "hey", "morning", "afternoon", "evening", "greetings"],
    replies: [
      "Hello. What are you trying to get done?",
      "Hi. What are you working on?"
    ]
  },
  {
    keywords: ["thanks", "thank", "cheers", "appreciated", "helpful", "perfect", "brilliant", "lovely"],
    replies: [
      "Glad that landed. Anything else you want to pick apart?",
      "Any time. Shout if something else comes up."
    ]
  },
  {
    keywords: ["who are you", "what are you", "your name", "about you", "are you ai", "are you real"],
    replies: [
      "I am Vanessa. I live on this page and answer questions about it. I run from a set of notes written about these tools, and if a language model is available on your computer I use that to phrase things, so nothing I do touches the internet.",
      "Vanessa. Think of me as the manual for this page, except you can argue with me. Everything I do stays on your machine."
    ]
  },
  {
    keywords: ["what can you do", "capabilities", "what do you know", "how can you help", "what should i ask"],
    replies: [
      "Ask me what a control does, why your file came out looking odd, or which tool fits the job you have. If you want me to comment on your actual data, use Change below and pick how much I get to see.",
      "Mostly: how this works, why it did that, and what to reach for next. I start out knowing nothing about your file, so use Change below if you want me looking at it."
    ]
  },
  {
    keywords: ["bye", "goodbye", "see you", "later", "that is all", "nothing else"],
    replies: [
      "Right you are. I will be down here if you need me.",
      "Good luck with it."
    ]
  },
  {
    keywords: ["sorry", "my bad", "oops", "ignore that", "never mind", "nevermind"],
    replies: [
      "No harm done. What did you actually want to know?",
      "All good. Try me again."
    ]
  }
];

const VANESSA_FOLLOWUP = ["more", "tell me more", "go on", "what else", "else", "continue", "and", "expand", "further", "why", "how so", "such as", "example", "keep going"];

const VANESSA_OPENERS = [
  "",
  "Short version: ",
  "Here is the bit that matters. ",
  "Right, so. "
];

let vanessaPendingTopics = [];
let vanessaTurnCount = 0;

function vanessaPickVariant(list) {
  return list[vanessaTurnCount % list.length];
}

function vanessaMatchesAny(tokens, keywordSets) {
  return keywordSets.some((keyword) => {
    const parts = vanessaTokenize(keyword);
    if (parts.length === 0) return false;
    return parts.every((p) => tokens.includes(p));
  });
}

function vanessaSmalltalkReply(tokens) {
  for (const item of VANESSA_SMALLTALK) {
    if (vanessaMatchesAny(tokens, item.keywords)) return vanessaPickVariant(item.replies);
  }
  return null;
}

function vanessaOfferMore() {
  if (vanessaPendingTopics.length === 0) return "";
  return vanessaPendingTopics.length === 1
    ? "\n\nThere is one more thing on this if you want it."
    : `\n\nI have a couple more angles on this if you want them.`;
}

function vanessaOfflineAnswer(toolId, question) {
  const entry = vanessaKnowledgeFor(toolId);
  const tokens = vanessaTokenize(question);
  const short = tokens.length <= 4;

  if (short) {
    const chit = vanessaSmalltalkReply(tokens);
    if (chit) return chit;
  }

  if (short && vanessaMatchesAny(tokens, VANESSA_FOLLOWUP) && vanessaPendingTopics.length > 0) {
    const next = vanessaPendingTopics.shift();
    return `${next}${vanessaOfferMore()}`;
  }

  const found = vanessaFindTopics(toolId, question, 4);

  if (found.length > 0) {
    vanessaPendingTopics = found.slice(1);
    return `${vanessaPickVariant(VANESSA_OPENERS)}${found[0]}${vanessaOfferMore()}`;
  }

  const chit = vanessaSmalltalkReply(tokens);
  if (chit) return chit;

  vanessaPendingTopics = [];

  if (entry) {
    return `I do not have a note on that one, and I would rather say so than invent something. What I can talk about is ${entry.summary.charAt(0).toLowerCase()}${entry.summary.slice(1)}\n\nTry me on one of the controls, or have a look at the Getting Started guide.`;
  }
  return "I do not have a note on that one, and I would rather say so than guess.";
}

function vanessaIsBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function vanessaToNumber(value) {
  if (vanessaIsBlank(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim().replace(/,/g, "");
  if (!/^[+-]?\$?(\d+\.?\d*|\.\d+)%?$/.test(s)) return null;
  const n = Number(s.replace(/[$%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function vanessaFallbackProfile(columns, rows) {
  return (columns || []).map((name) => {
    const values = rows.map((r) => r[name]);
    const present = values.filter((v) => !vanessaIsBlank(v));
    const distinct = new Set(present.map((v) => String(v)));
    const numbers = present.map(vanessaToNumber).filter((n) => n !== null);
    const numericRatio = present.length === 0 ? 0 : numbers.length / present.length;

    let type = "text";
    if (present.length === 0) type = "empty";
    else if (distinct.size === 1) type = "constant";
    else if (numericRatio >= 0.95) type = "number";
    else if (distinct.size <= Math.max(40, Math.floor(rows.length * 0.3))) type = "category";

    const base = {
      name,
      type,
      total: values.length,
      present: present.length,
      blankCount: values.length - present.length,
      distinctCount: distinct.size
    };

    if (type === "number" && numbers.length > 0) {
      const sorted = numbers.slice().sort((a, b) => a - b);
      base.min = sorted[0];
      base.max = sorted[sorted.length - 1];
      base.mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
      base.sorted = sorted;
    }

    return base;
  });
}

function vanessaProfile(columns, rows) {
  if (typeof profileDataset === "function") {
    try {
      return profileDataset(columns, rows);
    } catch (e) {
      return vanessaFallbackProfile(columns, rows);
    }
  }
  return vanessaFallbackProfile(columns, rows);
}

function vanessaMedian(sorted) {
  if (!sorted || sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function vanessaRound(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function vanessaTrimCell(value) {
  if (value === null || value === undefined) return null;
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return s.length > VANESSA_CELL_MAX ? s.slice(0, VANESSA_CELL_MAX) + "..." : s;
}

function vanessaLabelsFor(profile, rows) {
  const counts = new Map();
  for (const row of rows) {
    const raw = row[profile.name];
    if (vanessaIsBlank(raw)) continue;
    const key = String(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label: vanessaTrimCell(label), count }));
}

function vanessaBuildPayload(level, dataset, question) {
  const payload = { question: question === undefined ? "" : question };

  if (vanessaLevelIndex(level) < vanessaLevelIndex("structure")) return payload;
  if (!dataset || !dataset.columns || !dataset.rows) return payload;

  const columns = dataset.columns;
  const rows = dataset.rows;
  const profiles = vanessaProfile(columns, rows);

  payload.rowCount = rows.length;
  payload.columnCount = columns.length;
  payload.columns = profiles.map((p) => {
    const column = {
      name: p.name,
      type: p.type,
      distinctCount: p.distinctCount,
      blankCount: p.blankCount
    };

    if (vanessaLevelIndex(level) >= vanessaLevelIndex("aggregate")) {
      if (p.type === "number") {
        const sorted = p.sorted || [];
        column.min = vanessaRound(p.min);
        column.max = vanessaRound(p.max);
        column.mean = vanessaRound(p.mean);
        column.median = vanessaRound(vanessaMedian(sorted));
      }
      if ((p.type === "category" || p.type === "boolean") && p.distinctCount <= VANESSA_LABEL_MAX) {
        column.values = vanessaLabelsFor(p, rows);
      }
    }

    return column;
  });

  if (vanessaLevelIndex(level) >= vanessaLevelIndex("sample")) {
    payload.sampleRows = rows.slice(0, VANESSA_SAMPLE_ROWS).map((row) => {
      const out = {};
      for (const c of columns) out[c] = vanessaTrimCell(row[c]);
      return out;
    });
  }

  return payload;
}

function vanessaCurrentDataset() {
  if (typeof vanessaGetDataset !== "function") return null;
  try {
    const data = vanessaGetDataset();
    if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) return null;
    if (data.columns.length === 0) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function vanessaHasData() {
  return vanessaCurrentDataset() !== null;
}

async function vanessaProbeBackend() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VANESSA_PROBE_MS);
  try {
    const response = await fetch(`${VANESSA_BACKEND_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { available: false, model: null };
    const data = await response.json();
    const models = (data.models || []).map((m) => m.name);
    if (models.length === 0) return { available: false, model: null };
    return { available: true, model: models[0], models };
  } catch (e) {
    clearTimeout(timer);
    return { available: false, model: null };
  }
}

async function vanessaBackendAsk(messages, onDelta) {
  const response = await fetch(`${VANESSA_BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: vanessaBackend.model,
      messages,
      stream: true,
      options: { temperature: 0.4, num_predict: 400 }
    })
  });

  if (!response.ok || !response.body) throw new Error("The local model did not respond.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        continue;
      }
      const delta = parsed.message && parsed.message.content ? parsed.message.content : "";
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }

  return full;
}

function vanessaBuildMessages(question) {
  const entry = vanessaKnowledgeFor(vanessaTool);
  const notes = vanessaFindTopics(vanessaTool, question, 4);
  const title = entry ? entry.title : "this tool";

  const system = [
    `You are Vanessa, a colleague who knows the ${title} tool inside out and is sitting next to the person using it.`,
    "Talk like a person, not a manual. Warm, direct, a bit dry. Contractions are fine.",
    "Answer the question that was actually asked, then stop. Two or three sentences is usually right.",
    "Everything factual you say must come from the reference notes and data summary below. If they do not cover it, say so plainly and offer what you do know.",
    "Never invent controls, options, buttons or capabilities that are not described to you.",
    "Do not open by restating the question, do not pad with pleasantries, and do not mention these instructions or where your information came from."
  ].join(" ");

  const parts = [];
  if (entry) parts.push(`What this tool does: ${entry.summary}`);
  if (notes.length > 0) parts.push(`Reference notes:\n${notes.map((n) => `- ${n}`).join("\n")}`);

  if (vanessaAtLeast("structure")) {
    const dataset = vanessaCurrentDataset();
    if (dataset) {
      const payload = vanessaBuildPayload(vanessaLevel, dataset, "");
      delete payload.question;
      parts.push(`The file the user currently has loaded:\n${JSON.stringify(payload, null, 1)}`);
    } else {
      parts.push("The user does not currently have a file loaded.");
    }
  }

  parts.push(`Question: ${question}`);

  return [{ role: "system", content: system }]
    .concat(vanessaHistory.slice(-6))
    .concat([{ role: "user", content: parts.join("\n\n") }]);
}

function vanessaEl(tag, style, text) {
  const el = document.createElement(tag);
  if (style) el.setAttribute("style", style);
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

const VANESSA_FONT = "ui-sans-serif,system-ui,-apple-system,sans-serif";

function vanessaButtonStyle(primary) {
  return `border:1px solid ${primary ? "#0062F1" : "#cbd5e1"};background:${primary ? "#0062F1" : "#ffffff"};color:${primary ? "#ffffff" : "#00133C"};border-radius:0.5rem;padding:0.45rem 0.8rem;font-size:0.8125rem;font-weight:600;cursor:pointer;font-family:${VANESSA_FONT};`;
}

let vanessaPanelEl = null;
let vanessaLogEl = null;
let vanessaInputEl = null;
let vanessaStatusEl = null;

function vanessaAppendMessage(role, text) {
  const wrap = vanessaEl("div", `display:flex;justify-content:${role === "user" ? "flex-end" : "flex-start"};margin-bottom:0.6rem;`);
  const bubble = vanessaEl(
    "div",
    `max-width:85%;border-radius:0.75rem;padding:0.55rem 0.75rem;font-size:0.8125rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;${
      role === "user"
        ? "background:#0062F1;color:#ffffff;"
        : "background:#f1f5f9;color:#00133C;border:1px solid #e2e8f0;"
    }`,
    text
  );
  wrap.appendChild(bubble);
  vanessaLogEl.appendChild(wrap);
  vanessaLogEl.scrollTop = vanessaLogEl.scrollHeight;
  return bubble;
}

function vanessaSetStatus() {
  const label = VANESSA_LEVEL_LABELS[vanessaLevel];
  vanessaStatusEl.textContent = `Vanessa can see: ${label}`;
}

function vanessaOverlay() {
  const overlay = vanessaEl(
    "div",
    "position:fixed;inset:0;z-index:100000;background:rgba(0,19,60,0.55);display:flex;align-items:center;justify-content:center;padding:1.5rem;"
  );
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  return overlay;
}

function vanessaShowPayloadPreview(level) {
  const overlay = vanessaOverlay();
  const card = vanessaEl(
    "div",
    `background:#ffffff;border-radius:0.75rem;max-width:34rem;width:100%;max-height:80vh;overflow-y:auto;padding:1.25rem;font-family:${VANESSA_FONT};box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);`
  );

  const heading = vanessaEl("h2", "font-family:Lora,Georgia,serif;font-size:1.05rem;color:#00133C;margin:0 0 0.4rem;", "Exactly what would be sent");
  const blurb = vanessaEl(
    "p",
    "font-size:0.8125rem;color:#475569;margin:0 0 0.75rem;line-height:1.5;",
    "This is the literal content Vanessa would hand to the language model on this computer. Nothing else is included, and nothing goes over the internet."
  );

  const dataset = vanessaCurrentDataset();
  const payload = vanessaBuildPayload(level, dataset, "your typed question goes here");

  const pre = vanessaEl(
    "pre",
    "background:#0f172a;color:#e2e8f0;border-radius:0.5rem;padding:0.75rem;font-size:0.6875rem;line-height:1.5;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:0 0 0.9rem;",
    JSON.stringify(payload, null, 2)
  );

  if (!dataset && vanessaLevelIndex(level) >= vanessaLevelIndex("structure")) {
    blurb.textContent = "This is the literal content Vanessa would hand to the language model on this computer. You do not currently have a file loaded, so there is nothing from a file to show.";
  }

  const close = vanessaEl("button", vanessaButtonStyle(false), "Close");
  close.type = "button";
  close.addEventListener("click", () => overlay.remove());

  card.appendChild(heading);
  card.appendChild(blurb);
  card.appendChild(pre);
  card.appendChild(close);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function vanessaShowConsent() {
  const overlay = vanessaOverlay();
  const card = vanessaEl(
    "div",
    `background:#ffffff;border-radius:0.75rem;max-width:32rem;width:100%;max-height:85vh;overflow-y:auto;padding:1.25rem;font-family:${VANESSA_FONT};box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);`
  );

  card.appendChild(vanessaEl("h2", "font-family:Lora,Georgia,serif;font-size:1.15rem;color:#00133C;margin:0 0 0.35rem;", "What can Vanessa see?"));
  card.appendChild(
    vanessaEl(
      "p",
      "font-size:0.8125rem;color:#475569;margin:0 0 1rem;line-height:1.55;",
      "Every level below stays on this computer. Nothing is sent over the internet and nothing is remembered after you close this tab. You can drop back down to the lowest level at any time."
    )
  );

  for (const level of VANESSA_LEVELS) {
    const active = level === vanessaLevel;
    const needsData = vanessaLevelIndex(level) >= vanessaLevelIndex("structure");
    const row = vanessaEl(
      "div",
      `border:1px solid ${active ? "#0062F1" : "#e2e8f0"};background:${active ? "#eff6ff" : "#ffffff"};border-radius:0.6rem;padding:0.7rem 0.8rem;margin-bottom:0.55rem;`
    );

    row.appendChild(
      vanessaEl("p", `font-size:0.8125rem;font-weight:700;color:${active ? "#0062F1" : "#00133C"};margin:0 0 0.2rem;`, VANESSA_LEVEL_LABELS[level] + (active ? " (current)" : ""))
    );
    row.appendChild(vanessaEl("p", "font-size:0.75rem;color:#475569;margin:0 0 0.5rem;line-height:1.5;", VANESSA_LEVEL_BLURBS[level]));

    const actions = vanessaEl("div", "display:flex;gap:0.4rem;flex-wrap:wrap;");

    if (!active) {
      const choose = vanessaEl("button", vanessaButtonStyle(true), level === "offline" ? "Revoke access" : "Allow this");
      choose.type = "button";
      choose.addEventListener("click", () => {
        vanessaLevel = level;
        vanessaSetStatus();
        overlay.remove();
        vanessaAppendMessage("assistant", `Access set to: ${VANESSA_LEVEL_LABELS[level]}. ${VANESSA_LEVEL_BLURBS[level]}`);
      });
      actions.appendChild(choose);
    }

    if (level !== "offline") {
      const preview = vanessaEl("button", vanessaButtonStyle(false), "Show what would be sent");
      preview.type = "button";
      preview.addEventListener("click", () => vanessaShowPayloadPreview(level));
      actions.appendChild(preview);
    }

    row.appendChild(actions);

    if (needsData && !vanessaHasData()) {
      row.appendChild(vanessaEl("p", "font-size:0.6875rem;color:#b45309;margin:0.45rem 0 0;", "No file is loaded in this tool right now, so this level would add nothing yet."));
    }

    card.appendChild(row);
  }

  if (!vanessaBackend.available) {
    card.appendChild(
      vanessaEl(
        "p",
        "font-size:0.75rem;color:#475569;margin:0.5rem 0 0;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:0.7rem;",
        "No language model is reachable on this computer right now, so Vanessa is answering from her built-in help index. The levels above take effect if one becomes available."
      )
    );
  }

  const close = vanessaEl("button", vanessaButtonStyle(false) + "margin-top:0.7rem;", "Close");
  close.type = "button";
  close.addEventListener("click", () => overlay.remove());
  card.appendChild(close);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function vanessaSend() {
  const question = vanessaInputEl.value.trim();
  if (question === "" || vanessaBusy) return;

  vanessaBusy = true;
  vanessaTurnCount++;
  vanessaInputEl.value = "";
  vanessaAppendMessage("user", question);

  const useModel = vanessaBackend.available && vanessaAtLeast("ask");

  if (!useModel) {
    vanessaAppendMessage("assistant", vanessaOfflineAnswer(vanessaTool, question));
    vanessaBusy = false;
    return;
  }

  const bubble = vanessaAppendMessage("assistant", "");
  let streamed = "";

  try {
    const messages = vanessaBuildMessages(question);
    vanessaHistory.push({ role: "user", content: question });
    await vanessaBackendAsk(messages, (delta) => {
      streamed += delta;
      bubble.textContent = streamed;
      vanessaLogEl.scrollTop = vanessaLogEl.scrollHeight;
    });
    if (streamed.trim() === "") {
      bubble.textContent = vanessaOfflineAnswer(vanessaTool, question);
    } else {
      vanessaHistory.push({ role: "assistant", content: streamed });
    }
  } catch (e) {
    bubble.textContent = vanessaOfflineAnswer(vanessaTool, question);
  }

  vanessaBusy = false;
}

function vanessaBuildPanel() {
  const panel = vanessaEl(
    "div",
    `position:fixed;bottom:5.2rem;right:1.25rem;z-index:99998;width:22rem;max-width:calc(100vw - 2.5rem);height:30rem;max-height:calc(100vh - 8rem);background:#ffffff;border:1px solid #e2e8f0;border-radius:0.85rem;box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);display:none;flex-direction:column;overflow:hidden;font-family:${VANESSA_FONT};`
  );

  const header = vanessaEl("div", "background:#00133C;padding:0.75rem 0.9rem;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;");
  const titleWrap = vanessaEl("div", "");
  titleWrap.appendChild(vanessaEl("p", "font-family:Lora,Georgia,serif;font-size:0.95rem;color:#ffffff;margin:0;font-weight:600;", "Vanessa"));
  const entry = vanessaKnowledgeFor(vanessaTool);
  titleWrap.appendChild(vanessaEl("p", "font-size:0.6875rem;color:#94a3b8;margin:0.1rem 0 0;", entry ? entry.title : "Assistant"));

  const closeBtn = vanessaEl("button", "background:transparent;border:none;color:#94a3b8;font-size:1.35rem;line-height:1;cursor:pointer;padding:0 0.2rem;", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close Vanessa");
  closeBtn.addEventListener("click", () => vanessaToggle(false));

  header.appendChild(titleWrap);
  header.appendChild(closeBtn);

  vanessaLogEl = vanessaEl("div", "flex:1;overflow-y:auto;padding:0.9rem;background:#f8fafc;");

  const consentBar = vanessaEl("div", "display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.5rem 0.75rem;border-top:1px solid #e2e8f0;background:#ffffff;");
  vanessaStatusEl = vanessaEl("span", "font-size:0.6875rem;color:#475569;");
  const manage = vanessaEl("button", "background:transparent;border:none;color:#0062F1;font-size:0.6875rem;font-weight:700;cursor:pointer;padding:0;text-decoration:underline;", "Change");
  manage.type = "button";
  manage.addEventListener("click", vanessaShowConsent);
  consentBar.appendChild(vanessaStatusEl);
  consentBar.appendChild(manage);

  const inputRow = vanessaEl("div", "display:flex;gap:0.4rem;padding:0.6rem 0.75rem 0.75rem;border-top:1px solid #e2e8f0;background:#ffffff;");
  vanessaInputEl = document.createElement("input");
  vanessaInputEl.type = "text";
  vanessaInputEl.placeholder = vanessaTool === "hub" ? "Ask which tool to use..." : "Ask about this tool...";
  vanessaInputEl.setAttribute("style", `flex:1;border:1px solid #cbd5e1;border-radius:0.5rem;padding:0.45rem 0.6rem;font-size:0.8125rem;color:#00133C;outline:none;font-family:${VANESSA_FONT};`);
  vanessaInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      vanessaSend();
    }
  });

  const sendBtn = vanessaEl("button", vanessaButtonStyle(true), "Ask");
  sendBtn.type = "button";
  sendBtn.addEventListener("click", vanessaSend);

  inputRow.appendChild(vanessaInputEl);
  inputRow.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(vanessaLogEl);
  panel.appendChild(consentBar);
  panel.appendChild(inputRow);

  return panel;
}

function vanessaToggle(show) {
  const open = show === undefined ? vanessaPanelEl.style.display === "none" : show;
  vanessaPanelEl.style.display = open ? "flex" : "none";
  if (open) {
    if (!vanessaStarted) {
      vanessaStarted = true;
      const entry = vanessaKnowledgeFor(vanessaTool);
      const opening =
        vanessaTool === "hub"
          ? "Hi, I'm Vanessa. Tell me what you're trying to get done and I'll point you at the right tool. I can also explain the access codes, the shortcuts, or anything else about this page."
          : `Hi, I'm Vanessa. Ask me what anything in ${entry ? entry.title : "this tool"} does, or why your file came out looking strange.`;

      vanessaAppendMessage(
        "assistant",
        `${opening}\n\nRight now I know nothing about your file, and nothing leaves this tab. If you'd like me looking at your data, hit Change below and you decide exactly how much I get to see.`
      );
    }
    vanessaInputEl.focus();
  }
}

function vanessaInit(options) {
  if (typeof document === "undefined" || !options || !options.tool) return;
  if (document.getElementById("vanessa-launcher")) return;

  vanessaTool = options.tool;
  vanessaGetDataset = typeof options.getDataset === "function" ? options.getDataset : null;

  const launcher = vanessaEl(
    "button",
    `position:fixed;bottom:1.25rem;right:1.25rem;z-index:99999;height:3rem;padding:0 1.1rem;border-radius:9999px;border:none;background:#0062F1;color:#ffffff;font-size:0.8125rem;font-weight:700;cursor:pointer;box-shadow:0 10px 25px -5px rgba(0,98,241,0.5);font-family:${VANESSA_FONT};`,
    "Ask Vanessa"
  );
  launcher.type = "button";
  launcher.id = "vanessa-launcher";
  launcher.addEventListener("click", () => vanessaToggle());

  vanessaPanelEl = vanessaBuildPanel();

  document.body.appendChild(vanessaPanelEl);
  document.body.appendChild(launcher);

  vanessaSetStatus();

  vanessaProbeBackend().then((result) => {
    vanessaBackend = result;
  });
}
