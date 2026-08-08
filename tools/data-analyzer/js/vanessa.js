const VANESSA_LEVELS = ["offline", "ask", "structure", "aggregate", "sample"];

const VANESSA_LEVEL_LABELS = {
  offline: "Built-in help only",
  ask: "My questions",
  structure: "Column names and types",
  aggregate: "Summary statistics",
  sample: "Sample rows"
};

const VANESSA_LEVEL_BLURBS = {
  offline: "Vanessa answers from a built-in help index and from what she can read on the page in front of you. Nothing leaves this browser tab at all.",
  ask: "Your typed question leaves this tab and goes to a language model running on this computer, along with the page's own headings, button names and control labels. No part of your file is included.",
  structure: "Also includes your column names, their detected types, the row and column counts, and what each control on the page is currently set to. No cell values.",
  aggregate: "Also includes summary statistics such as min, max, mean, median, blanks and distinct counts, the actual labels of columns that have 25 or fewer distinct values, and how many rows any table on screen is showing. No raw records.",
  sample: "Also includes up to five real rows from your file, and up to three rows of any table on screen, with actual cell values."
};

const VANESSA_GREETING = "Hi, I'm Vanessa! How can I help you?";

const VANESSA_LABEL_MAX = 25;
const VANESSA_SAMPLE_ROWS = 5;
const VANESSA_CELL_MAX = 80;
const VANESSA_BACKEND_URL = "http://127.0.0.1:11434";
const VANESSA_PROBE_MS = 1200;
const VANESSA_HISTORY_MESSAGES = 16;

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

const VANESSA_WORD_ENDINGS = ["s", "es", "d", "ed", "ing", "er", "ers"];

function vanessaSameWord(a, b) {
  if (a === b) return true;
  const long = a.length > b.length ? a : b;
  const short = a.length > b.length ? b : a;
  if (short.length < 3 || !long.startsWith(short)) return false;
  return VANESSA_WORD_ENDINGS.indexOf(long.slice(short.length)) !== -1;
}

const VANESSA_SYNONYM_GROUPS = {
  chart: ["graph", "plot", "visualise", "visualize", "visualisation", "visualization", "viz", "diagram", "picture", "visual"],
  duplicate: ["dupe", "dedupe", "deduplicate", "deduplication", "duplication"],
  merge: ["join", "combine", "lookup", "vlookup", "consolidate", "stitch"],
  delete: ["remove", "erase", "discard", "strip"],
  fix: ["repair", "correct", "resolve"],
  error: ["mistake", "problem", "issue", "fault", "bug", "failure"],
  big: ["large", "huge", "massive", "enormous", "giant"],
  change: ["edit", "modify", "adjust", "alter", "tweak"],
  pick: ["choose", "select", "decide"],
  average: ["avg"],
  total: ["sum", "subtotal"],
  percent: ["percentage", "pct", "proportion"],
  sort: ["order", "rank", "arrange"],
  download: ["export", "save"],
  upload: ["import", "attach"],
  private: ["privacy", "confidential", "sensitive"],
  explain: ["describe", "clarify", "elaborate"],
  threshold: ["cutoff", "sensitivity", "tolerance", "strictness", "slider"],
  blank: ["empty", "missing", "null"],
  convert: ["transform", "translate"],
  excel: ["xlsx", "xls", "spreadsheet", "workbook"],
  fast: ["quick", "speed"],
  number: ["numeric", "numerical", "quantity"],
  unique: ["distinct"],
  timezone: ["tz"],
  regex: ["regexp", "pattern"],
  colour: ["color"]
};

const VANESSA_SYNONYMS = (function () {
  const map = {};
  for (const canonical of Object.keys(VANESSA_SYNONYM_GROUPS)) {
    for (const variant of VANESSA_SYNONYM_GROUPS[canonical]) map[variant] = canonical;
  }
  return map;
})();

function vanessaCanon(word) {
  if (Object.prototype.hasOwnProperty.call(VANESSA_SYNONYMS, word)) return VANESSA_SYNONYMS[word];
  for (const ending of VANESSA_WORD_ENDINGS) {
    if (word.length <= ending.length + 2) continue;
    if (word.slice(word.length - ending.length) !== ending) continue;
    const stem = word.slice(0, word.length - ending.length);
    if (Object.prototype.hasOwnProperty.call(VANESSA_SYNONYMS, stem)) return VANESSA_SYNONYMS[stem];
  }
  return word;
}

function vanessaCanonTokens(text) {
  return vanessaTokenize(text).map(vanessaCanon);
}

function vanessaEditDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = new Array(cols);
  for (let j = 0; j < cols; j++) previous[j] = j;

  for (let i = 1; i < rows; i++) {
    const current = new Array(cols);
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }

  return previous[cols - 1];
}

function vanessaNearWord(a, b) {
  if (a.length < 5 || b.length < 5) return false;
  if (a.charAt(0) !== b.charAt(0)) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  return vanessaEditDistance(a, b) === 1;
}

function vanessaScoreTopic(tokens, topic, loose) {
  if (tokens.length === 0) return 0;
  let score = 0;
  let echoed = false;
  const seen = {};

  for (const keyword of topic.keywords) {
    const parts = vanessaTokenize(keyword).map(vanessaCanon);
    if (parts.length === 0) continue;

    const hit = parts.every((p) => tokens.some((t) => vanessaSameWord(t, p) || (loose && vanessaNearWord(t, p))));
    if (!hit) continue;

    const signature = parts.join(" ");
    if (Object.prototype.hasOwnProperty.call(seen, signature)) {
      echoed = true;
      continue;
    }

    seen[signature] = true;
    score += parts.length > 1 ? 3 : 2;
  }

  return score === 0 ? 0 : score + (echoed ? 1 : 0);
}

function vanessaKnowledgeFor(toolId) {
  if (typeof VANESSA_KNOWLEDGE === "undefined") return null;
  return VANESSA_KNOWLEDGE[toolId] || null;
}

function vanessaRankTopics(toolId, question, loose) {
  const tokens = vanessaCanonTokens(question);
  const entry = vanessaKnowledgeFor(toolId);
  const shared = typeof VANESSA_SHARED_TOPICS === "undefined" ? [] : VANESSA_SHARED_TOPICS;
  const pool = (entry ? entry.topics : []).map((t) => ({ topic: t, boost: 3, own: true })).concat(shared.map((t) => ({ topic: t, boost: 0, own: false })));

  return pool
    .map((item) => {
      const raw = vanessaScoreTopic(tokens, item.topic, loose);
      return { text: item.topic.text, own: item.own, score: raw === 0 ? 0 : raw + item.boost };
    })
    .filter((item) => item.score > 1)
    .sort((a, b) => b.score - a.score);
}

function vanessaFindTopics(toolId, question, limit = 3) {
  return vanessaRankTopics(toolId, question).slice(0, limit).map((item) => item.text);
}

function vanessaOwnTopicScore(toolId, question, loose) {
  const entry = vanessaKnowledgeFor(toolId);
  if (!entry) return 0;
  const tokens = vanessaCanonTokens(question);
  let best = 0;
  for (const topic of entry.topics) best = Math.max(best, vanessaScoreTopic(tokens, topic, loose));
  return best;
}

const VANESSA_TOOL_ALIASES = {
  "data-analyzer": ["data analyzer", "data analyser"],
  "instant-dashboard": ["instant dashboard"],
  "dashboard-builder": ["dashboard builder"],
  "file-diff": ["file diff", "file compare"],
  "pivot-explorer": ["pivot explorer", "pivot and chart explorer", "pivot table"],
  "data-cleaner": ["data cleaner"],
  "converter": ["format converter"],
  "column-stats": ["column statistics", "column stats"],
  "sql-workbench": ["sql workbench"],
  "lookup-merge": ["lookup and merge", "lookup merge"],
  "fuzzy-dupes": ["fuzzy duplicate finder", "fuzzy duplicates", "fuzzy dupes", "fuzzy matching"],
  "chart-builder": ["chart builder"],
  "data-generator": ["test data generator", "data generator"],
  "code-helper": ["code helper"],
  "json-formatter": ["json formatter"],
  "timestamp-converter": ["timestamp converter"],
  "regex-tester": ["regex tester"],
  "text-diff": ["text diff"],
  "color-tools": ["color tools", "colour tools"],
  "text-analyzer": ["text analyzer", "text analyser"],
  "qr-generator": ["qr code generator", "qr generator", "qr code"],
  "markdown-preview": ["markdown previewer", "markdown preview"],
  "encode-decode": ["base64 and url encoder", "base64 encoder"],
  "unit-converter": ["unit converter"],
  "jwt-decoder": ["jwt decoder"]
};

function vanessaContentWords(text) {
  return vanessaTokenize(text).filter((word) => VANESSA_LABEL_STOPWORDS.indexOf(word) === -1);
}

function vanessaToolAffinity(toolId, tokens, loose) {
  const entry = vanessaKnowledgeFor(toolId);
  if (!entry) return 0;

  let best = 0;
  for (const topic of entry.topics) best = Math.max(best, vanessaScoreTopic(tokens, topic, loose));

  const title = vanessaScoreTopic(tokens, { keywords: vanessaContentWords(entry.title) }, false);
  const summary = vanessaScoreTopic(tokens, { keywords: vanessaContentWords(entry.summary) }, false);

  return best * 2 + title * 2 + Math.min(summary, 4);
}

function vanessaNamedTool(question, currentTool) {
  for (const id of Object.keys(VANESSA_TOOL_ALIASES)) {
    if (id === currentTool) continue;
    if (!vanessaKnowledgeFor(id)) continue;
    if (vanessaMatchesAny(question, VANESSA_TOOL_ALIASES[id])) return id;
  }
  return null;
}

function vanessaRankTools(question, currentTool) {
  if (typeof VANESSA_KNOWLEDGE === "undefined") return [];
  const tokens = vanessaCanonTokens(question);

  return Object.keys(VANESSA_KNOWLEDGE)
    .filter((id) => id !== currentTool && id !== "hub")
    .map((id) => ({ id: id, score: vanessaToolAffinity(id, tokens, false) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function vanessaBestOtherTool(question, currentTool) {
  const ranked = vanessaRankTools(question, currentTool);
  return ranked.length > 0 && ranked[0].score >= 8 ? ranked[0] : null;
}

function vanessaDescribeOtherTool(toolId, currentTool, question) {
  const entry = vanessaKnowledgeFor(toolId);
  if (!entry) return null;

  const lead = currentTool === "hub"
    ? `${entry.title} is the one for that.`
    : `That one belongs to ${entry.title} rather than this page.`;

  let alternative = "";
  if (question) {
    const ranked = vanessaRankTools(question, currentTool).filter((item) => item.id !== toolId);
    const runnerUp = ranked.length > 0 ? ranked[0] : null;
    const chosen = vanessaRankTools(question, currentTool).find((item) => item.id === toolId);
    if (runnerUp && chosen && chosen.score - runnerUp.score <= 3) {
      const other = vanessaKnowledgeFor(runnerUp.id);
      if (other) alternative = ` ${other.title} is the other candidate: ${other.summary}`;
    }
  }

  return `${lead} ${entry.summary}${alternative}\n\nIt has its own card on the hub. Open it there and I will be waiting on that page with notes specific to it.`;
}

const VANESSA_SMALLTALK = [
  {
    keywords: ["how are you", "how are u", "how r u", "hows it going", "how is it going", "how are things", "you ok", "are you ok", "you good", "you alright", "how you doing", "how are you doing", "hows your day", "how is your day", "whats up", "what is up", "sup"],
    replies: [
      "Perfectly fine, in the way a help system is fine. More to the point, what are you working on?",
      "No complaints, I don't have the equipment for them. What are you trying to get done?"
    ]
  },
  {
    keywords: ["hi", "hello", "hey", "morning", "afternoon", "evening", "greetings", "yo", "howdy", "hiya", "you there", "anyone there", "hello there", "is anyone there", "test", "testing"],
    replies: [
      "Hello. What are you trying to get done?",
      "Hi. What are you working on?"
    ]
  },
  {
    keywords: ["do you sleep", "do you eat", "do you dream", "are you alive", "do you have feelings", "do you get bored", "do you like", "whats your favourite", "whats your favorite", "do you have a favourite", "how old are you", "where do you live", "do you get tired"],
    replies: [
      "None of that applies to me, I'm afraid. I'm a set of notes with opinions. Ask me something about the tool and I get much more interesting.",
      "I don't do any of that. What I do is explain this page, which is admittedly a narrower life. What are you after?"
    ]
  },
  {
    keywords: ["you are useless", "youre useless", "this is useless", "you are rubbish", "youre rubbish", "you are bad", "youre terrible", "you suck", "you are annoying", "hate this", "this is rubbish", "this is terrible", "waste of time", "you are wrong", "stupid"],
    replies: [
      "Fair enough. Tell me what you actually wanted and I'll have another go, or say what I got wrong and I'll not repeat it.",
      "Noted, and probably deserved. What were you trying to find out?"
    ]
  },
  {
    keywords: ["sorry", "my bad", "oops", "ignore that", "never mind", "nevermind", "typo", "meant to say", "disregard", "i apologize", "i apologise", "my mistake", "apologies", "sorry about that", "i didnt mean"],
    replies: [
      "No harm done. What did you actually want to know?",
      "All good. Try me again."
    ]
  },
  {
    keywords: ["ok", "okay", "sure", "right", "cool", "fine", "alright", "gotcha", "understood", "makes sense", "fair enough", "i see", "ah", "hmm", "interesting"],
    replies: [
      "Anything else you want to poke at?",
      "Say the word if you want to go further on that."
    ]
  },
  {
    keywords: ["lol", "haha", "funny", "tell me a joke", "make me laugh", "be funny", "you are funny", "amusing"],
    replies: [
      "I'd tell you a joke about duplicate rows, but you'd have heard it twice. Anyway. What are we doing?",
      "My material is all data cleaning, so it's a tough room. What did you need?"
    ]
  },
  {
    keywords: ["i am confused", "im confused", "confusing", "i dont get it", "i do not get it", "makes no sense", "doesnt make sense", "does not make sense", "what do you mean", "huh", "come again", "you lost me"],
    replies: [
      "That's on me. Which bit lost you? I'll take it slower or come at it differently.",
      "Let me try again. Point at the part that didn't land and I'll rephrase it."
    ]
  },
  {
    keywords: ["thanks", "thank", "cheers", "appreciated", "helpful", "perfect", "brilliant", "lovely", "great", "awesome", "nice one", "that helps", "that helped", "got it", "good stuff", "you are great", "youre great", "well done", "legend", "you are a star", "life saver", "lifesaver"],
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
    keywords: ["forget it", "forget that", "skip that", "not important", "doesnt matter", "does not matter", "change the subject", "different question"],
    replies: [
      "Dropped. What would you rather look at?",
      "Consider it forgotten. What else?"
    ]
  },
  {
    keywords: ["yes", "yeah", "yep", "yup", "sure", "of course", "definitely", "absolutely", "correct", "thats right", "that is right", "sounds good", "for sure", "indeed", "please do", "go ahead"],
    replies: [
      "Right, what next?",
      "Good. Where do you want to take it?"
    ]
  },
  {
    keywords: ["no", "nope", "nah", "not really", "no thanks", "i dont think so", "not at all", "negative", "i disagree", "not quite"],
    replies: [
      "Fair. What is it you're actually after?",
      "Noted. Point me at the right thing."
    ]
  },
  {
    keywords: ["say that again", "repeat that", "can you repeat", "one more time", "come again", "didnt catch that", "did not catch", "pardon", "what did you say"],
    replies: [
      "Ask me the original question again and I'll put it a different way.",
      "Happy to go again. Re-ask it and I'll rephrase."
    ]
  },
  {
    keywords: ["are you sure", "is that true", "is that right", "is that correct", "really", "seriously", "are you certain", "prove it"],
    replies: [
      "On how the tool behaves, yes, that comes from written notes. On anything about your actual numbers, check it against the tool's own output, because that is where I'm weakest.",
      "Reasonably. Anything I say about the tool is grounded; anything about your specific data deserves a second look."
    ]
  },
  {
    keywords: ["that doesnt make sense", "that does not make sense", "thats not what i asked", "that is not what i asked", "you misunderstood", "you didnt answer", "you did not answer", "not what i meant"],
    replies: [
      "My fault. Ask it again in your own words and I'll aim better.",
      "Let's reset. What was the actual question?"
    ]
  },
  {
    keywords: ["how old are you", "when were you created", "when were you made", "whats your age", "what is your age"],
    replies: [
      "I'm a file on this site, so about as old as the last deploy. Not a useful number.",
      "No age to speak of. I get replaced whenever someone pushes a change."
    ]
  },
  {
    keywords: ["where are you", "where do you live", "where are you from", "whats your location", "are you in the cloud", "are you on a server", "where do you run"],
    replies: [
      "Right here in this browser tab, and if there's a model helping me it's on your machine too. None of me lives in a data centre.",
      "In your browser. That's rather the whole point of me."
    ]
  },
  {
    keywords: ["im bored", "i am bored", "entertain me", "nothing to do", "keep me entertained", "amuse me"],
    replies: [
      "Load a messy file and let's find out what's wrong with it. That's my idea of a good time.",
      "I'm poor entertainment, but I'm good at working out why your data looks wrong. Fancy it?"
    ]
  },
  {
    keywords: ["whats the weather", "is it going to rain", "hows the weather", "is it sunny", "temperature outside", "what time is it", "whats the time", "todays date", "what day is it", "what year is it"],
    replies: [
      "No idea, I can't see out. I only know about this page.",
      "Outside my remit entirely. Ask me about the tool and I'm better company."
    ]
  },
  {
    keywords: ["what do you like", "your hobbies", "do you have hobbies", "what do you do for fun", "favourite food", "favorite food", "do you like pizza", "what music", "favourite song", "favorite song", "do you listen to music"],
    replies: [
      "None of that applies to me, but I'll happily talk about badly formatted spreadsheets, which is the closest thing I have to a passion.",
      "I don't have any of that. Data quality is the only thing I hold opinions about."
    ]
  },
  {
    keywords: ["motivate me", "i need motivation", "encourage me", "pep talk", "i need encouragement", "cheer me up"],
    replies: [
      "The file is probably less broken than it looks. Start with one column, work out what's actually in it, and the rest usually follows.",
      "Most data problems are three small problems wearing a trenchcoat. Take the top one."
    ]
  },
  {
    keywords: ["i got it working", "it worked", "that worked", "i fixed it", "sorted it", "figured it out", "i did it"],
    replies: [
      "Good. What's next?",
      "Nice. Anything else you want to tidy up while you're here?"
    ]
  },
  {
    keywords: ["i give up", "im done", "this is too hard", "i cant do this", "i quit", "rough day", "bad day"],
    replies: [
      "Before you do, tell me the last thing that failed. Half of these turn out to be one wrong column.",
      "Fair enough, it's tedious work. Describe what's going wrong and I'll narrow it down."
    ]
  },
  {
    keywords: ["what do you think", "your opinion", "do you have opinions", "your take", "do you agree", "what would you do", "what do you reckon"],
    replies: [
      "I do have opinions and I'll give them, but say what you're weighing up first so mine is worth something.",
      "Happy to say what I'd do. What's the choice you're stuck on?"
    ]
  },
  {
    keywords: ["recommend", "recommendation", "any suggestions", "what do you suggest", "what should i use", "which should i pick"],
    replies: [
      "Tell me what you're trying to end up with and I'll point you at the tool for it.",
      "Describe the outcome you want and I'll name the tool."
    ]
  },
  {
    keywords: ["and you", "what about you", "how about yourself", "and yourself", "you too"],
    replies: [
      "Nothing to report, which is the ideal state for a help system. What are we doing?",
      "All quiet on my end. What are you working on?"
    ]
  },
  {
    keywords: ["feedback", "report an issue", "report a bug", "suggest an improvement", "who do i tell", "can i complain"],
    replies: [
      "The footer on the hub has an email address for exactly that. Worth saying what you expected and what happened instead.",
      "There's a contact link at the bottom of the hub. Expected versus actual is the useful thing to include."
    ]
  },
  {
    keywords: ["ping", "are you working", "is this working", "can you hear me", "are you online", "still there", "you alive"],
    replies: [
      "Here and working. Ask away.",
      "Still here. What do you need?"
    ]
  }
];

const VANESSA_FOLLOWUP_PHRASE = [
  "tell me more", "go on", "what else", "anything else", "what other", "keep going",
  "carry on", "say more", "explain more", "go deeper", "in detail", "and then",
  "ok and", "yes and", "more please", "such as", "for example", "give me an example",
  "like what", "how so", "and after that", "what next", "whats next", "anything more",
  "is that all", "that it", "is that it", "more on that", "more detail"
];

const VANESSA_FOLLOWUP_WORD = ["more", "else", "continue", "expand", "further", "elaborate", "next", "then", "why", "and"];

const VANESSA_ABOUT_SELF = [
  "what do you do", "what can you do", "what could you do", "what will you do",
  "who are you", "what are you", "what are you for", "what r u", "who r u",
  "how can you help", "how can you assist", "how do you help",
  "what do you know", "what is your job", "what is your role", "your purpose",
  "about yourself", "about you", "why are you here", "what use are you",
  "are you ai", "are you an ai", "are you a bot", "are you a robot", "are you real",
  "are you human", "are you a person", "are you chatgpt", "are you gpt", "are you claude",
  "what is your name", "whats your name", "who is vanessa", "what is vanessa",
  "who are u", "tell me about you", "tell me about yourself", "introduce yourself",
  "how do you work", "how were you made", "what model are you", "which model",
  "who made you", "who built you", "who created you", "what are you good at",
  "what are you bad at", "why do you exist", "what do you actually do",
  "what is the point of you", "are you useful", "do you actually help",
  "what are your limits", "what can you not do", "what cant you do"
];

const VANESSA_ABOUT_PRIVACY = [
  "can you see my data", "can you see my file", "can you see this", "can you see it",
  "do you see my data", "do you see my file", "what can you see", "what do you see",
  "are you reading my data", "are you reading my file", "can you read my file",
  "can you read my data", "do you have access", "do you have my data",
  "is my data safe", "is my data private", "is my data secure", "is this safe",
  "is this private", "is this secure", "is it safe", "is it private",
  "do you send my data", "do you send anything", "is anything sent", "does my data leave",
  "does anything leave", "where does my data go", "where does it go", "where is it sent",
  "do you upload", "does anything get uploaded", "is anything uploaded", "do you upload my file",
  "who sees this", "who can see", "who has access", "are you spying", "are you tracking me",
  "do you track", "do you store my data", "do you keep my data", "do you save my data",
  "do you log", "is this confidential", "gdpr", "what do you know about my file",
  "am i sharing", "does this go to the cloud", "is this going anywhere",
  "does this leave my computer", "does it leave my machine", "is it local"
];

const VANESSA_ABOUT_TOOL = [
  "what does this tool do", "what does this do", "what is this tool", "what is this",
  "what is this for", "what does it do", "what is it for", "explain this tool",
  "what can this tool do", "what does this page do", "purpose of this tool",
  "what am i looking at", "overview", "what is this thing", "what is this page",
  "what can i do", "what can i do here", "what do i do", "what do i do here",
  "what should i do", "what should i do here", "what am i supposed to do",
  "where do i start", "where do i begin", "how do i start", "how do i begin",
  "show me around", "give me a tour", "what are my options", "what are the options",
  "what can this page do", "what is the point", "what is the point of this",
  "why would i use this", "when would i use this", "what is it good for",
  "what does this screen do", "tell me about this tool", "describe this tool"
];

const VANESSA_ABOUT_TOOL_WEAK = [
  "how does this work", "how does it work", "how do i use this", "how do you use this",
  "how do i use it", "how does this thing work", "help", "help me", "i need help",
  "getting started", "get started", "how to start", "confused", "lost", "stuck",
  "no idea", "i have no idea", "not sure", "unsure", "dont understand",
  "do not understand", "dont know", "do not know", "i dont know", "i do not know",
  "guide me", "walk me through", "talk me through", "explain", "explain this",
  "what now", "now what", "where to begin", "first step", "first steps",
  "point me", "any ideas", "any suggestions", "suggestions", "advice",
  "what would you do", "what should i try", "where should i look", "give me a hint",
  "im new", "i am new", "new here", "never used this", "first time"
];

const VANESSA_OPENERS = ["", "So: ", "Right. ", "Okay. "];

const VANESSA_AFFIRM = [
  "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please", "yes please", "go ahead",
  "do it", "sounds good", "why not", "alright", "hit me", "lets have it", "let me have it",
  "i would", "id like", "i do", "of course", "definitely", "absolutely", "the rest",
  "all of it", "both", "lets hear it", "let me hear it", "fire away", "go for it"
];

const VANESSA_DECLINE = [
  "no", "nope", "nah", "no thanks", "no thank you", "not now", "im good", "i am good",
  "thats fine", "that is fine", "no need", "leave it", "skip it", "dont bother",
  "do not bother", "thats enough", "that is enough", "im done", "i am done"
];

const VANESSA_ANAPHORA = ["it", "its", "they", "them", "those"];

const VANESSA_REFERRING = [
  "it", "its", "that", "this", "them", "they", "those", "these", "one", "ones",
  "there", "then", "instead", "either", "same", "above", "again"
];

let vanessaPendingTopics = [];
let vanessaTurnCount = 0;
let vanessaSubject = "";
let vanessaLastTopic = "";
let vanessaSaidTopics = [];

function vanessaIsAffirmative(question) {
  return vanessaMatchesAny(question, VANESSA_AFFIRM);
}

function vanessaIsDecline(question) {
  return vanessaMatchesAny(question, VANESSA_DECLINE);
}

function vanessaRefersBack(tokens) {
  if (tokens.length <= 3) return true;
  return tokens.length <= 9 && tokens.some((t) => VANESSA_REFERRING.indexOf(t) !== -1);
}

function vanessaRemember(text) {
  vanessaLastTopic = text;
  if (vanessaSaidTopics.indexOf(text) === -1) vanessaSaidTopics.push(text);
  if (vanessaSaidTopics.length > 40) vanessaSaidTopics.shift();
}

function vanessaResetConversation() {
  vanessaPendingTopics = [];
  vanessaSubject = "";
  vanessaLastTopic = "";
  vanessaSaidTopics = [];
}

const VANESSA_MEMORY_KEY = "vanessa_memory";
const VANESSA_MEMORY_MAX = 20;
const VANESSA_MEMORY_CHARS = 240;

const VANESSA_MEMORY_TRIGGERS = [
  /^\s*remember(?:\s+that)?[:,\s]+(.+)$/i,
  /^\s*(?:please\s+)?note(?:\s+that)?[:,\s]+(.+)$/i,
  /^\s*keep in mind(?:\s+that)?[:,\s]+(.+)$/i,
  /^\s*don'?t forget(?:\s+that)?[:,\s]+(.+)$/i,
  /^\s*for future reference[:,\s]+(.+)$/i,
  /^\s*from now on[:,\s]+(.+)$/i
];

let vanessaMemoryOn = false;

function vanessaMemoryRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(VANESSA_MEMORY_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw;
  } catch (e) {
    return {};
  }
}

function vanessaMemoryFor(toolId) {
  const all = vanessaMemoryRead();
  const list = Object.prototype.hasOwnProperty.call(all, toolId) ? all[toolId] : [];
  return Array.isArray(list) ? list.filter((item) => item && typeof item.text === "string") : [];
}

function vanessaMemoryWrite(toolId, list) {
  try {
    const all = vanessaMemoryRead();
    all[toolId] = list.slice(-VANESSA_MEMORY_MAX);
    localStorage.setItem(VANESSA_MEMORY_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    return false;
  }
}

function vanessaMemoryAdd(toolId, text) {
  const clean = String(text || "").trim().replace(/\s+/g, " ").slice(0, VANESSA_MEMORY_CHARS);
  if (clean === "") return null;

  const list = vanessaMemoryFor(toolId);
  const already = list.some((item) => item.text.toLowerCase() === clean.toLowerCase());
  if (already) return null;

  list.push({ text: clean, at: new Date().toISOString().slice(0, 10) });
  vanessaMemoryWrite(toolId, list);
  return clean;
}

function vanessaMemoryForget(toolId, index) {
  const list = vanessaMemoryFor(toolId);
  if (index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  return vanessaMemoryWrite(toolId, list);
}

function vanessaMemoryClear(toolId) {
  try {
    const all = vanessaMemoryRead();
    delete all[toolId];
    localStorage.setItem(VANESSA_MEMORY_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    return false;
  }
}

function vanessaMemoryCandidate(question) {
  for (const pattern of VANESSA_MEMORY_TRIGGERS) {
    const match = String(question || "").match(pattern);
    if (match && match[1] && match[1].trim().length > 2) return match[1].trim();
  }
  return null;
}

function vanessaPickVariant(list) {
  return list[vanessaTurnCount % list.length];
}

function vanessaPhrase(text) {
  const words = String(text === null || text === undefined ? "" : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  return ` ${words.join(" ")} `;
}

function vanessaMatchesAny(tokensOrText, keywordSets) {
  const haystack = Array.isArray(tokensOrText) ? ` ${tokensOrText.join(" ")} ` : vanessaPhrase(tokensOrText);
  return keywordSets.some((keyword) => {
    const needle = vanessaPhrase(keyword);
    return needle.trim() !== "" && haystack.indexOf(needle) !== -1;
  });
}

function vanessaSmalltalkReply(question) {
  const haystack = vanessaPhrase(question);
  let best = null;
  let bestLength = 0;

  for (const item of VANESSA_SMALLTALK) {
    for (const keyword of item.keywords) {
      const needle = vanessaPhrase(keyword);
      if (needle.trim() === "" || haystack.indexOf(needle) === -1) continue;
      if (needle.length > bestLength) {
        bestLength = needle.length;
        best = item;
      }
    }
  }

  return best ? vanessaPickVariant(best.replies) : null;
}

function vanessaOfferMore() {
  if (vanessaPendingTopics.length === 0) return "";
  return vanessaPendingTopics.length === 1
    ? "\n\nThere is one more thing on this if you want it."
    : `\n\nI have a couple more angles on this if you want them.`;
}

function vanessaDescribeSelf(entry) {
  const where = entry ? entry.title : "this page";
  return `I'm Vanessa. I explain how ${where} works, why your file behaved the way it did, and which tool to reach for when this one is the wrong shape for the job.\n\nI start out knowing nothing about your file and nothing leaves this tab. If you want me looking at your actual data, use Change below and you pick how much I see.`;
}

function vanessaDescribeTool(entry, toolId) {
  if (!entry) return "I'm not sure what this page is, which is not a great look for me.";

  const examples = entry.topics
    .slice(0, 3)
    .map((topic) => topic.keywords[0])
    .filter((k) => typeof k === "string" && k.length > 2);

  const opener = toolId === "hub"
    ? `This is the ${entry.title}. ${entry.summary}`
    : `${entry.title}. ${entry.summary}`;

  const body = examples.length > 0
    ? `${opener}\n\nAsk me about ${examples.join(", ")}, or anything else you can see on the page.`
    : opener;

  return `${body}${vanessaPageAside()}`;
}

function vanessaDescribePrivacy() {
  const level = VANESSA_LEVEL_LABELS[vanessaLevel].toLowerCase();

  const head = vanessaLevel === "offline"
    ? "Right now I can see nothing at all. I'm answering from a set of notes built into this page, and no request leaves this tab."
    : `Right now I'm set to "${level}". ${VANESSA_LEVEL_BLURBS[vanessaLevel]}`;

  const tail = vanessaBackend.available
    ? "When I do send something, it goes to a language model running on this same computer. Nothing goes over the internet, and nothing reaches me, my makers, or anyone else."
    : "There's no language model reachable on this machine at the moment, so nothing is being sent anywhere regardless.";

  return `${head}\n\n${tail}\n\nUse Change below to see the exact text I would send, or to take access away again. It resets to the lowest level every time you close the tab.`;
}

const VANESSA_PAGE_TEXT_MAX = 80;
const VANESSA_PAGE_CONTROL_MAX = 40;
const VANESSA_PAGE_BUTTON_MAX = 30;
const VANESSA_PAGE_NOTICE_MAX = 8;
const VANESSA_PAGE_TABLE_MAX = 4;
const VANESSA_PAGE_TABLE_ROWS = 3;
const VANESSA_PAGE_OPTION_MAX = 30;

const VANESSA_NOTICE_SELECTOR =
  "[role='alert'],[role='status'],[class*='error'],[class*='warn'],[class*='alert'],[class*='amber'],[class*='danger'],[class*='red-']";

const VANESSA_INTERACTIVE_SELECTOR = "button,a,input,select,textarea,label,[role='button']";

const VANESSA_LABEL_STOPWORDS = [
  "the", "and", "for", "you", "your", "this", "that", "what", "how", "are", "is",
  "to", "of", "in", "on", "do", "does", "it", "an", "or", "be", "with", "from"
];

function vanessaCleanText(value) {
  const text = String(value === null || value === undefined ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > VANESSA_PAGE_TEXT_MAX ? text.slice(0, VANESSA_PAGE_TEXT_MAX) + "..." : text;
}

function vanessaOwnNode(el) {
  return !!(el && el.closest && el.closest("[data-vanessa]"));
}

function vanessaVisible(el) {
  if (!el || vanessaOwnNode(el)) return false;
  if (el.isConnected === false) return true;
  if (typeof window === "undefined" || !window.getComputedStyle) return true;

  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (typeof el.getClientRects !== "function") return true;

  return el.getClientRects().length > 0;
}

function vanessaLabelFor(el, root) {
  const aria = el.getAttribute("aria-label");
  if (aria) return vanessaCleanText(aria);

  const id = el.getAttribute("id");
  if (id) {
    const labels = root.querySelectorAll("label");
    for (const label of labels) {
      if (label.getAttribute("for") === id) return vanessaCleanText(label.textContent);
    }
  }

  const wrapping = el.closest ? el.closest("label") : null;
  if (wrapping) return vanessaCleanText(wrapping.textContent);

  const placeholder = el.getAttribute("placeholder");
  if (placeholder) return vanessaCleanText(placeholder);

  const title = el.getAttribute("title");
  if (title) return vanessaCleanText(title);

  const name = el.getAttribute("name");
  if (name) return vanessaCleanText(name);

  return "";
}

function vanessaControlKind(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") return "dropdown";
  if (tag === "textarea") return "text box";

  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (type === "checkbox") return "checkbox";
  if (type === "radio") return "radio button";
  if (type === "range") return "slider";
  if (type === "file") return "file picker";
  if (type === "number") return "number box";
  if (type === "color") return "colour picker";
  if (type === "date") return "date box";

  return "text box";
}

function vanessaControlValue(el) {
  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    const option = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
    return option ? vanessaCleanText(option.textContent) : "";
  }

  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (type === "checkbox" || type === "radio") return el.checked ? "on" : "off";
  if (type === "file") {
    const count = el.files ? el.files.length : 0;
    return count === 0 ? "nothing chosen" : `${count} file${count === 1 ? "" : "s"} chosen`;
  }

  return vanessaCleanText(el.value);
}

function vanessaControlOptions(el) {
  if (el.tagName.toLowerCase() !== "select" || !el.options) return null;
  const out = [];
  for (const option of el.options) {
    if (out.length >= VANESSA_PAGE_OPTION_MAX) break;
    const text = vanessaCleanText(option.textContent);
    if (text !== "") out.push(text);
  }
  return out;
}

function vanessaPageNotices(root) {
  const out = [];
  const seen = {};

  for (const el of root.querySelectorAll(VANESSA_NOTICE_SELECTOR)) {
    if (out.length >= VANESSA_PAGE_NOTICE_MAX) break;
    if (!vanessaVisible(el)) continue;
    if (el.matches && el.matches(VANESSA_INTERACTIVE_SELECTOR)) continue;
    if (el.closest && el.closest(VANESSA_INTERACTIVE_SELECTOR)) continue;
    if (el.querySelector && el.querySelector(VANESSA_NOTICE_SELECTOR)) continue;

    const text = vanessaCleanText(el.textContent);
    if (text.length < 3) continue;
    if (Object.prototype.hasOwnProperty.call(seen, text)) continue;

    seen[text] = true;
    out.push(text);
  }

  return out;
}

function vanessaPageTables(root) {
  const out = [];

  for (const table of root.querySelectorAll("table")) {
    if (out.length >= VANESSA_PAGE_TABLE_MAX) break;
    if (!vanessaVisible(table)) continue;

    const columns = [];
    const headerCells = table.querySelectorAll("thead th, thead td");
    for (const cell of headerCells) columns.push(vanessaCleanText(cell.textContent));

    if (columns.length === 0) {
      const firstRow = table.querySelector("tr");
      if (firstRow) for (const cell of firstRow.children) columns.push(vanessaCleanText(cell.textContent));
    }

    const bodyRows = table.querySelectorAll("tbody tr");
    const rows = [];
    const limit = Math.min(bodyRows.length, VANESSA_PAGE_TABLE_ROWS);

    for (let i = 0; i < limit; i++) {
      const cells = [];
      for (const cell of bodyRows[i].children) cells.push(vanessaCleanText(cell.textContent));
      rows.push(cells);
    }

    out.push({ columns: columns.slice(0, 25), rowCount: bodyRows.length, rows: rows });
  }

  return out;
}

function vanessaScanPage(root) {
  const scope = root || (typeof document === "undefined" ? null : document.body);
  if (!scope || typeof scope.querySelectorAll !== "function") return null;

  const headingEl = scope.querySelector("h1");
  const heading = headingEl && vanessaVisible(headingEl) ? vanessaCleanText(headingEl.textContent) : "";

  const sections = [];
  for (const el of scope.querySelectorAll("h2, h3")) {
    if (sections.length >= 12) break;
    if (!vanessaVisible(el)) continue;
    const text = vanessaCleanText(el.textContent);
    if (text !== "" && sections.indexOf(text) === -1) sections.push(text);
  }

  const controls = [];
  for (const el of scope.querySelectorAll("input, select, textarea")) {
    if (controls.length >= VANESSA_PAGE_CONTROL_MAX) break;
    if (!vanessaVisible(el)) continue;
    if ((el.getAttribute("type") || "").toLowerCase() === "hidden") continue;

    controls.push({
      label: vanessaLabelFor(el, scope),
      kind: vanessaControlKind(el),
      value: vanessaControlValue(el),
      options: vanessaControlOptions(el)
    });
  }

  const buttons = [];
  for (const el of scope.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")) {
    if (buttons.length >= VANESSA_PAGE_BUTTON_MAX) break;
    if (!vanessaVisible(el)) continue;

    const tag = el.tagName.toLowerCase();
    const text = tag === "input" ? vanessaCleanText(el.value) : vanessaCleanText(el.textContent);
    if (text === "" || buttons.indexOf(text) !== -1) continue;

    buttons.push(text);
  }

  return {
    heading: heading,
    sections: sections,
    controls: controls,
    buttons: buttons,
    notices: vanessaPageNotices(scope),
    tables: vanessaPageTables(scope),
    stats: vanessaReadStats(scope)
  };
}

function vanessaPageContext(level, snapshot) {
  const page = snapshot || vanessaScanPage();
  if (!page) return null;

  const atLeast = (name) => vanessaLevelIndex(level) >= vanessaLevelIndex(name);
  if (!atLeast("ask")) return null;

  const context = {
    heading: page.heading,
    sections: page.sections,
    buttons: page.buttons,
    controls: page.controls.map((control) => {
      const item = { label: control.label, kind: control.kind };
      if (atLeast("structure")) {
        item.value = control.value;
        if (control.options && control.options.length > 0) item.options = control.options;
      }
      return item;
    })
  };

  if (atLeast("structure")) {
    context.notices = page.notices;
    context.tables = page.tables.map((table) => ({ columns: table.columns }));
  }

  if (atLeast("aggregate")) {
    context.tables = page.tables.map((table) => ({ columns: table.columns, rowsOnScreen: table.rowCount }));
    if (page.stats && page.stats.length > 0) context.figuresOnScreen = page.stats;
  }

  if (atLeast("sample")) {
    context.tables = page.tables.map((table) => ({
      columns: table.columns,
      rowsOnScreen: table.rowCount,
      firstRows: table.rows
    }));
  }

  return context;
}

const VANESSA_PAGE_WHAT = [
  "what is on this page", "whats on this page", "what is on the page", "whats on the page",
  "what can i click", "what buttons", "what controls", "what are the controls",
  "what can i change", "what settings", "what fields", "what is on screen",
  "whats on screen", "what does the page show", "what do you see", "what can you see on the page",
  "list the controls", "list the buttons", "what can i press", "read the page",
  "describe the page", "what is in front of me"
];

const VANESSA_PAGE_STATE = [
  "what is it set to", "whats it set to", "what is set to", "whats selected",
  "what is selected", "what did i pick", "what did i choose", "what is the current",
  "whats the current", "current setting", "current value", "what is chosen",
  "what have i got selected", "what am i set to", "what is it on", "whats it on"
];

const VANESSA_PAGE_PROBLEM = [
  "what is the error", "whats the error", "is there an error", "what does the error say",
  "what is the warning", "whats the warning", "what does the warning say", "why is it red",
  "what does that message say", "what is that message", "any warnings", "any errors",
  "what is it complaining about", "what does this message mean"
];

const VANESSA_PAGE_EXPLAIN = [
  "what does this data say", "what is this data saying", "what does the data say",
  "explain this data", "explain the data", "what does the data show", "read the data",
  "what does this show", "what does this tell me", "what is this telling me",
  "summarise this", "summarize this", "summarise the data", "summarize the data",
  "interpret this", "what stands out", "anything interesting", "whats interesting",
  "what is interesting", "what do you make of this", "explain these results",
  "what do the results say", "what does the table say", "read the table",
  "explain the table", "break this down", "what do these numbers mean",
  "what do the numbers say", "talk me through the numbers", "whats the story",
  "what is the story", "anything wrong with my data", "whats wrong with my data",
  "what is wrong with my data", "what does this file look like", "describe my data",
  "tell me about my data", "tell me about this data", "what is in my file",
  "whats in my file", "what is in this file", "how does my data look"
];

const VANESSA_STAT_PATTERN = /^[-+]?[$£€]?\s?[\d][\d,]*(\.\d+)?\s?([KMB]|%)?$/;

function vanessaFormatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const rounded = Math.abs(value) >= 1000 ? Math.round(value) : Math.round(value * 100) / 100;
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function vanessaJoinNames(list) {
  const names = list.slice(0, 4);
  const extra = list.length - names.length;
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return extra > 0 ? `${joined} and ${extra} more` : joined;
}

function vanessaDateText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return vanessaCleanText(value);
}

function vanessaReadTableData(root, limit) {
  const scope = root || (typeof document === "undefined" ? null : document.body);
  if (!scope || typeof scope.querySelectorAll !== "function") return null;

  let best = null;
  for (const table of scope.querySelectorAll("table")) {
    if (!vanessaVisible(table)) continue;
    const bodyRows = table.querySelectorAll("tbody tr");
    if (!best || bodyRows.length > best.count) best = { table: table, count: bodyRows.length };
  }

  if (!best || best.count === 0) return null;

  const columns = [];
  for (const cell of best.table.querySelectorAll("thead th, thead td")) columns.push(vanessaCleanText(cell.textContent));

  if (columns.length === 0) {
    const firstRow = best.table.querySelector("tr");
    if (firstRow) for (const cell of firstRow.children) columns.push(vanessaCleanText(cell.textContent));
  }
  if (columns.length === 0) return null;

  const names = [];
  for (let i = 0; i < columns.length; i++) {
    const raw = columns[i] === "" ? `column_${i + 1}` : columns[i];
    names.push(names.indexOf(raw) === -1 ? raw : `${raw}_${i + 1}`);
  }

  const bodyRows = best.table.querySelectorAll("tbody tr");
  const cap = Math.min(bodyRows.length, limit || 1000);
  const rows = [];

  for (let i = 0; i < cap; i++) {
    const cells = bodyRows[i].children;
    const row = {};
    for (let c = 0; c < names.length; c++) row[names[c]] = c < cells.length ? vanessaCleanText(cells[c].textContent) : "";
    rows.push(row);
  }

  return { columns: names, rows: rows };
}

function vanessaReadStats(root) {
  const scope = root || (typeof document === "undefined" ? null : document.body);
  if (!scope || typeof scope.querySelectorAll !== "function") return [];

  const out = [];
  let visited = 0;

  for (const el of scope.querySelectorAll("p, span, div, strong, h2, h3, dd, td")) {
    if (out.length >= 12 || visited > 4000) break;
    visited++;

    if (el.children.length > 0 || !vanessaVisible(el)) continue;
    if (el.closest && (el.closest("table") || el.closest(VANESSA_INTERACTIVE_SELECTOR))) continue;

    const value = vanessaCleanText(el.textContent);
    if (value === "" || value.length > 16 || !VANESSA_STAT_PATTERN.test(value)) continue;

    const parent = el.parentElement;
    if (!parent) continue;

    let label = "";
    for (const sibling of parent.children) {
      if (sibling === el || sibling.children.length > 0) continue;
      const text = vanessaCleanText(sibling.textContent);
      if (text !== "" && !VANESSA_STAT_PATTERN.test(text) && text.length <= 60) {
        label = text;
        break;
      }
    }

    if (label === "") continue;
    out.push({ label: label, value: value });
  }

  return out;
}

function vanessaDataObservations(columns, rows) {
  const profiles = vanessaProfile(columns, rows);
  const notes = [];

  const empties = profiles.filter((p) => p.type === "empty").map((p) => p.name);
  if (empties.length > 0) {
    notes.push(`${vanessaJoinNames(empties)} ${empties.length === 1 ? "is" : "are"} completely empty.`);
  }

  const constants = profiles.filter((p) => p.type === "constant").map((p) => p.name);
  if (constants.length > 0) {
    notes.push(`${vanessaJoinNames(constants)} ${constants.length === 1 ? "holds" : "hold"} the same value in every row, so there is nothing to compare within ${constants.length === 1 ? "it" : "them"}.`);
  }

  const patchy = profiles
    .filter((p) => p.type !== "empty" && p.total > 0 && p.blankCount / p.total >= 0.25)
    .slice(0, 3);
  for (const p of patchy) {
    notes.push(`${p.name} is ${Math.round((p.blankCount / p.total) * 100)} percent blank, which will quietly drop rows if you filter or join on it.`);
  }

  const dates = profiles.filter((p) => p.type === "date");
  if (dates.length > 0 && dates[0].min && dates[0].max) {
    notes.push(`${dates[0].name} spans ${vanessaDateText(dates[0].min)} to ${vanessaDateText(dates[0].max)}.`);
  }

  for (const p of profiles.filter((item) => item.type === "number").slice(0, 3)) {
    const median = vanessaMedian(p.sorted || []);
    let line = `${p.name} runs from ${vanessaFormatNumber(p.min)} to ${vanessaFormatNumber(p.max)}, averaging ${vanessaFormatNumber(p.mean)}`;

    if (median !== null) {
      line += `, with a midpoint of ${vanessaFormatNumber(median)}`;
      if (median > 0 && p.mean / median >= 1.5) line += ". The average sits well above the midpoint, so a few large values are pulling it up";
      else if (p.mean > 0 && median / p.mean >= 1.5) line += ". The midpoint sits above the average, so a tail of small values is dragging it down";
    }

    notes.push(`${line}.`);
  }

  const categories = profiles
    .filter((item) => (item.type === "category" || item.type === "boolean") && item.distinctCount <= VANESSA_LABEL_MAX)
    .sort((a, b) => a.distinctCount - b.distinctCount)
    .slice(0, 3);

  for (const p of categories) {
    const labels = vanessaLabelsFor(p, rows);
    if (labels.length === 0) continue;
    const share = Math.round((labels[0].count / Math.max(p.present, 1)) * 100);
    const tail = share >= 60 ? `, so it is dominated by one value` : "";
    notes.push(`${p.name} has ${p.distinctCount} distinct values and ${labels[0].label} is ${share} percent of them${tail}.`);
  }

  const ids = profiles.filter((p) => p.type === "identifier").map((p) => p.name);
  if (ids.length > 0) {
    notes.push(`${vanessaJoinNames(ids)} ${ids.length === 1 ? "looks like an identifier" : "look like identifiers"} rather than something to total.`);
  }

  return notes;
}

const VANESSA_LOCAL_NOTE = "That is worked out here in the tab from what is already on your screen. None of it was sent anywhere.";

function vanessaExplainData() {
  const dataset = vanessaCurrentDataset();
  let columns = null;
  let rows = null;
  let source = "";

  if (dataset) {
    columns = dataset.columns;
    rows = dataset.rows;
    source = "The file you have loaded";
  } else {
    const table = vanessaReadTableData();
    if (table) {
      columns = table.columns;
      rows = table.rows;
      source = "The table on screen";
    }
  }

  if (!columns || rows.length === 0) {
    const stats = vanessaReadStats();
    if (stats.length === 0) return null;
    return `I cannot see a table of rows, but these are the figures the page is showing:\n\n${stats
      .slice(0, 8)
      .map((stat) => `- ${stat.label}: ${stat.value}`)
      .join("\n")}\n\n${VANESSA_LOCAL_NOTE}`;
  }

  const notes = vanessaDataObservations(columns, rows);
  const head = `${source} has ${vanessaFormatNumber(rows.length)} rows and ${columns.length} columns.`;

  const body = notes.length === 0
    ? "Nothing jumps out as broken: no empty columns, no columns stuck on a single value, and nothing heavily blank."
    : notes.slice(0, 7).map((note) => `- ${note}`).join("\n");

  const stats = vanessaReadStats();
  const figures = stats.length === 0
    ? ""
    : `\n\nThe page itself is reporting:\n${stats.slice(0, 6).map((stat) => `- ${stat.label}: ${stat.value}`).join("\n")}`;

  return `${head}\n\n${body}${figures}\n\n${VANESSA_LOCAL_NOTE}`;
}

function vanessaFindControl(page, tokens) {
  const canon = tokens.map(vanessaCanon);
  let best = null;

  for (const control of page.controls) {
    if (control.label === "") continue;

    let score = 0;
    for (const part of vanessaCanonTokens(control.label)) {
      if (VANESSA_LABEL_STOPWORDS.indexOf(part) !== -1) continue;
      if (canon.some((t) => vanessaSameWord(t, part))) score++;
    }

    if (score > 0 && (!best || score > best.score)) best = { score: score, label: control.label, value: control.value };
  }

  return best;
}

const VANESSA_PAGE_CUE = ["page", "screen", "showing", "shown", "display", "displayed", "tile", "tiles", "on here", "up there"];

function vanessaFindStat(page, tokens) {
  if (!page.stats || page.stats.length === 0) return null;
  const canon = tokens.map(vanessaCanon);
  let best = null;

  for (const stat of page.stats) {
    let score = 0;
    for (const part of vanessaCanonTokens(stat.label)) {
      if (VANESSA_LABEL_STOPWORDS.indexOf(part) !== -1) continue;
      if (canon.some((t) => vanessaSameWord(t, part))) score++;
    }
    if (score > 0 && (!best || score > best.score)) best = { score: score, label: stat.label, value: stat.value };
  }

  return best;
}

function vanessaControlLine(control) {
  const label = control.label;
  const shows = control.value !== "" && label.indexOf(control.value) === -1;
  return `- ${label}${shows ? `: ${control.value}` : ""}`;
}

function vanessaDescribePage(page) {
  const parts = [];

  if (page.heading !== "") parts.push(`You are on ${page.heading}.`);

  const labelled = page.controls.filter((control) => control.label !== "");
  if (labelled.length > 0) {
    const list = labelled.slice(0, 10).map((control) => {
      const shows = control.value !== "" && control.label.indexOf(control.value) === -1;
      return `- ${control.label} (${control.kind}${shows ? `, currently ${control.value}` : ""})`;
    });
    parts.push(`Controls on the page:\n${list.join("\n")}`);
  }

  if (page.buttons.length > 0) parts.push(`Buttons: ${page.buttons.slice(0, 12).join(", ")}.`);

  if (page.stats && page.stats.length > 0) {
    parts.push(`Figures on screen:\n${page.stats.slice(0, 8).map((stat) => `- ${stat.label}: ${stat.value}`).join("\n")}`);
  }

  if (page.tables.length > 0 && page.tables[0].columns.length > 0) {
    const table = page.tables[0];
    parts.push(`There is a table on screen with ${table.rowCount} rows and these columns: ${table.columns.slice(0, 10).join(", ")}.`);
  }

  if (page.notices.length > 0) parts.push(`It is also showing: ${page.notices[0]}`);

  if (parts.length === 0) return "I cannot see anything interactive on this page, which is unusual. Ask me about the tool itself instead.";

  return `${parts.join("\n\n")}\n\nThat is read straight off the screen in this tab, not sent anywhere.`;
}

function vanessaPageAside() {
  if (!vanessaPanelEl) return "";

  const page = vanessaScanPage();
  if (!page) return "";

  const bits = [];
  if (page.controls.length > 0) bits.push(`${page.controls.length} control${page.controls.length === 1 ? "" : "s"}`);
  if (page.buttons.length > 0) bits.push(`${page.buttons.length} button${page.buttons.length === 1 ? "" : "s"}`);
  if (bits.length === 0) return "";

  return `\n\nI can also see the page itself: ${bits.join(" and ")} right now. Ask me what any of them is set to, or say what is on this page for the full list.`;
}

function vanessaPageAnswer(question, tokens) {
  if (!vanessaPanelEl) return null;

  const page = vanessaScanPage();
  if (!page) return null;

  if (vanessaMatchesAny(question, VANESSA_PAGE_PROBLEM)) {
    if (page.notices.length === 0) {
      return "Nothing on the page is flagging an error or a warning that I can see. If something still looks wrong, tell me what you expected and I will work backwards from that.";
    }
    return `The page is showing this right now:\n\n${page.notices.map((notice) => `- ${notice}`).join("\n")}`;
  }

  if (vanessaMatchesAny(question, VANESSA_PAGE_EXPLAIN)) {
    const explained = vanessaExplainData();
    if (explained) return explained;
    return "There is no data on the screen for me to read yet. Load a file or run something, then ask me again and I will tell you what it is saying.";
  }

  if (vanessaMatchesAny(question, VANESSA_PAGE_CUE)) {
    const stat = vanessaFindStat(page, tokens);
    if (stat) return `${stat.label} on screen reads ${stat.value}.`;
  }

  if (vanessaMatchesAny(question, VANESSA_PAGE_WHAT)) return vanessaDescribePage(page);

  if (vanessaMatchesAny(question, VANESSA_PAGE_STATE)) {
    const control = vanessaFindControl(page, tokens);
    if (control) return `${control.label} is currently set to ${control.value === "" ? "nothing" : control.value}.`;

    const stat = vanessaFindStat(page, tokens);
    if (stat) return `${stat.label} on screen reads ${stat.value}.`;

    const set = page.controls.filter((item) => item.label !== "" && item.value !== "" && item.value !== "nothing chosen" && item.value !== "off");
    if (set.length === 0) return "Nothing on the page has been set yet as far as I can see.";

    return `Here is what the page is set to right now:\n\n${set.slice(0, 10).map(vanessaControlLine).join("\n")}`;
  }

  return null;
}

function vanessaDeliverTopic(ranked, question, subjectUsed) {
  const chosen = ranked[0];
  const floor = chosen.score * 0.5;

  vanessaPendingTopics = ranked
    .slice(1)
    .filter((item) => item.score >= floor && item.text !== chosen.text && vanessaSaidTopics.indexOf(item.text) === -1)
    .slice(0, 3)
    .map((item) => item.text);

  const repeat = chosen.text === vanessaLastTopic;
  vanessaRemember(chosen.text);
  if (!subjectUsed) vanessaSubject = question;

  const opener = repeat
    ? "Same note as before, but it does cover that. "
    : subjectUsed
    ? ""
    : vanessaPickVariant(VANESSA_OPENERS);

  return `${opener}${chosen.text}${vanessaOfferMore()}`;
}

function vanessaOfflineAnswer(toolId, question) {
  const entry = vanessaKnowledgeFor(toolId);
  const tokens = vanessaTokenize(question);
  const short = tokens.length <= 6;

  if (vanessaMatchesAny(question, VANESSA_ABOUT_PRIVACY)) return vanessaDescribePrivacy();
  if (vanessaMatchesAny(question, VANESSA_ABOUT_SELF)) return vanessaDescribeSelf(entry);

  const pageAnswer = vanessaPageAnswer(question, tokens);
  if (pageAnswer) return pageAnswer;

  const anaphoric = vanessaSubject !== "" && tokens.some((t) => VANESSA_ANAPHORA.indexOf(t) !== -1);
  const aboutTool = vanessaMatchesAny(question, VANESSA_ABOUT_TOOL);

  if (aboutTool && !anaphoric) return vanessaDescribeTool(entry, toolId);

  const isFollowUp =
    vanessaMatchesAny(question, VANESSA_FOLLOWUP_PHRASE) ||
    (tokens.length <= 2 && vanessaMatchesAny(question, VANESSA_FOLLOWUP_WORD));

  if (short && vanessaPendingTopics.length > 0) {
    if (vanessaIsDecline(question)) {
      vanessaPendingTopics = [];
      return "Right, I will leave that there. What else do you want to look at?";
    }
    if (isFollowUp || vanessaIsAffirmative(question)) {
      const next = vanessaPendingTopics.shift();
      vanessaRemember(next);
      return `${next}${vanessaOfferMore()}`;
    }
  }

  if (short) {
    const chit = vanessaSmalltalkReply(question);
    if (chit) return chit;
  }

  if (short && isFollowUp) {
    return "That's everything I have on that one. Ask me something else and I'll see what I've got.";
  }

  const named = vanessaNamedTool(question, toolId);
  if (named) {
    const routed = vanessaDescribeOtherTool(named, toolId, question);
    if (routed) {
      vanessaPendingTopics = [];
      return routed;
    }
  }

  const canFollow = vanessaSubject !== "" && vanessaRefersBack(tokens);
  const blended = canFollow ? `${question} ${vanessaSubject}` : "";

  let ranked = vanessaRankTopics(toolId, question);
  let ownScore = vanessaOwnTopicScore(toolId, question, false);
  let subjectUsed = false;

  if (ownScore === 0 && canFollow) {
    const blendedRanked = vanessaRankTopics(toolId, blended);
    if (blendedRanked.length > 0) {
      ranked = blendedRanked;
      ownScore = vanessaOwnTopicScore(toolId, blended, false);
      subjectUsed = true;
    }
  }

  if (ownScore === 0) {
    const other = vanessaBestOtherTool(question, toolId);
    if (other) {
      const routed = vanessaDescribeOtherTool(other.id, toolId, question);
      if (routed) {
        vanessaPendingTopics = [];
        return routed;
      }
    }
  }

  if (ranked.length === 0) {
    const loose = vanessaRankTopics(toolId, question, true);
    if (loose.length > 0) ranked = loose;
  }

  if (ranked.length === 0 && canFollow) {
    const looseBlended = vanessaRankTopics(toolId, blended, true);
    if (looseBlended.length > 0) {
      ranked = looseBlended;
      subjectUsed = true;
    }
  }

  if (ranked.length > 0) return vanessaDeliverTopic(ranked, question, subjectUsed);

  const chit = vanessaSmalltalkReply(question);
  if (chit) return chit;

  vanessaPendingTopics = [];

  if (aboutTool) return vanessaDescribeTool(entry, toolId);
  if (vanessaMatchesAny(question, VANESSA_ABOUT_TOOL_WEAK)) return vanessaDescribeTool(entry, toolId);

  if (entry) {
    return `I do not have a note on that one, and I would rather say so than invent something. What I can talk about is ${entry.summary.charAt(0).toLowerCase()}${entry.summary.slice(1)}\n\nTry putting it another way, ask me about one of the controls, or tell me what you are trying to end up with and I will name the tool for it.`;
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
    const entries = data.models || [];
    if (entries.length === 0) return { available: false, model: null };

    const withThinking = entries.find((m) => (m.capabilities || []).indexOf("thinking") !== -1);
    const chosen = withThinking || entries[0];

    return {
      available: true,
      model: chosen.name,
      nativeThinking: !!withThinking,
      models: entries.map((m) => m.name)
    };
  } catch (e) {
    clearTimeout(timer);
    return { available: false, model: null };
  }
}

async function vanessaBackendAsk(messages, onDelta, onThinking, signal) {
  const body = {
    model: vanessaBackend.model,
    messages,
    stream: true,
    options: { temperature: 0.7, num_predict: 900, top_p: 0.9 }
  };

  if (vanessaBackend.nativeThinking) body.think = true;

  const response = await fetch(`${VANESSA_BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal
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
      const message = parsed.message || {};

      if (message.thinking && onThinking) onThinking(message.thinking);

      const delta = message.content ? message.content : "";
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }

  return full;
}

function vanessaConversationText(question) {
  const recent = vanessaHistory.filter((m) => m.role === "user").slice(-3).map((m) => m.content);
  return recent.concat([question]).join(" ");
}

function vanessaRelevantSharedNotes(text, limit) {
  const shared = typeof VANESSA_SHARED_TOPICS === "undefined" ? [] : VANESSA_SHARED_TOPICS;
  const tokens = vanessaTokenize(text);
  return shared
    .map((topic) => ({ text: topic.text, score: vanessaScoreTopic(tokens, topic) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.text);
}

function vanessaToolCatalogue(currentTool) {
  if (typeof VANESSA_KNOWLEDGE === "undefined") return "";
  return Object.keys(VANESSA_KNOWLEDGE)
    .filter((id) => id !== currentTool && id !== "hub")
    .map((id) => `- ${VANESSA_KNOWLEDGE[id].title}: ${VANESSA_KNOWLEDGE[id].summary}`)
    .join("\n");
}

function vanessaStripTags(text) {
  return text.replace(/<\/?think>/g, "").trim();
}

function vanessaSplitThinking(text) {
  const open = text.indexOf("<think>");
  const close = text.indexOf("</think>");

  if (open === -1 && close === -1) return { thinking: "", answer: text };

  if (open === -1) {
    return {
      thinking: text.slice(0, close).trim(),
      answer: vanessaStripTags(text.slice(close + 8))
    };
  }

  if (close === -1 || close < open) {
    return { thinking: vanessaStripTags(text.slice(open + 7)), answer: "" };
  }

  return {
    thinking: text.slice(open + 7, close).trim(),
    answer: vanessaStripTags(text.slice(0, open) + text.slice(close + 8))
  };
}

function vanessaPersona(title) {
  return [
    `You are Vanessa, a sharp, friendly colleague helping someone use ${title}.`,
    "",
    "Answer their question directly. Two or three sentences. Use contractions. Have an opinion.",
    "",
    "Rules:",
    "1. Start with <think>, work out the answer in a few scrappy lines, then </think>, then your reply.",
    "2. Your reply must make sense on its own. Never refer back to your thinking.",
    "3. Only describe buttons, settings and behaviour that appear in the notes below. If it is not in the notes, say you are not sure.",
    "4. If the job belongs to a different tool in the list, name that tool and say so.",
    "5. General data advice is yours to give freely. Flag it as your opinion.",
    "6. Answer only what was asked. Do not add unrelated tips.",
    "",
    `If they ask what you do, say you explain how ${title} works and help them pick the right tool, and that you cannot see their file unless they let you.`,
    `If they ask what this tool does, answer from the tool summary in the notes below and give one or two examples of what to ask.`
  ].join("\n");
}

function vanessaBuildMessages(question) {
  const entry = vanessaKnowledgeFor(vanessaTool);
  const title = entry ? entry.title : "this tool";

  const blocks = [vanessaPersona(title)];

  if (entry) {
    const notes = entry.topics.map((t) => `- ${t.text}`).join("\n");
    blocks.push(`Reference notes on ${title} (${entry.summary})\n${notes}`);
  }

  const catalogue = vanessaToolCatalogue(vanessaTool);
  if (catalogue) {
    blocks.push(
      `The other tools on this hub, in case the job they are describing belongs to one of them. Say so when it does, and name it. Do not pretend they are features of the tool they are currently in:\n${catalogue}`
    );
  }

  const sharedNotes = vanessaRelevantSharedNotes(vanessaConversationText(question), 4);
  if (sharedNotes.length > 0) {
    blocks.push(`Reference notes that apply across the whole hub:\n${sharedNotes.map((n) => `- ${n}`).join("\n")}`);
  }

  if (vanessaMemoryOn) {
    const remembered = vanessaMemoryFor(vanessaTool);
    if (remembered.length > 0) {
      blocks.push(
        `Things this person asked you to remember from previous visits. Treat them as true and act on them without being asked again, but do not recite them back unprompted:\n${remembered
          .map((item) => `- ${item.text}`)
          .join("\n")}`
      );
    }
  }

  const focused = vanessaRankTopics(vanessaTool, vanessaConversationText(question)).slice(0, 3);
  if (focused.length > 0) {
    blocks.push(
      `Of those notes, these look closest to what they just asked. Lead with them:\n${focused.map((item) => `- ${item.text}`).join("\n")}`
    );
  }

  const pageContext = vanessaPageContext(vanessaLevel);
  if (pageContext) {
    blocks.push(
      `What is actually on their screen right now. Use it to answer questions about what they can see, what a control is set to, and what a result is saying. Never invent a control that is not listed here:\n${JSON.stringify(pageContext, null, 1)}`
    );
  }

  if (vanessaAtLeast("structure")) {
    const dataset = vanessaCurrentDataset();
    if (dataset) {
      const payload = vanessaBuildPayload(vanessaLevel, dataset, "");
      delete payload.question;
      blocks.push(`The file they have open right now:\n${JSON.stringify(payload, null, 1)}`);
    } else {
      blocks.push("They have not loaded a file yet, so you cannot say anything about their data.");
    }
  } else {
    blocks.push("You cannot see their file, so do not describe their data or guess at their column names.");
  }

  return [{ role: "system", content: blocks.join("\n\n") }]
    .concat(vanessaHistory.slice(-VANESSA_HISTORY_MESSAGES))
    .concat([{ role: "user", content: question }]);
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
let vanessaSendBtn = null;
let vanessaAbort = null;

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

function vanessaBuildThinkingBlock() {
  const root = vanessaEl("div", "display:none;width:100%;margin-bottom:0.35rem;");

  const toggle = vanessaEl(
    "button",
    `border:none;background:transparent;color:#64748b;font-size:0.6875rem;font-weight:700;cursor:pointer;padding:0;display:flex;align-items:center;gap:0.3rem;font-family:${VANESSA_FONT};`,
    "Show thinking"
  );
  toggle.type = "button";

  const body = vanessaEl(
    "div",
    "display:none;margin-top:0.3rem;padding:0.5rem 0.65rem;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:0.5rem;font-size:0.6875rem;line-height:1.5;color:#64748b;white-space:pre-wrap;word-break:break-word;max-height:11rem;overflow-y:auto;"
  );

  let open = false;
  toggle.addEventListener("click", () => {
    open = !open;
    body.style.display = open ? "block" : "none";
    toggle.textContent = open ? "Hide thinking" : "Show thinking";
  });

  root.appendChild(toggle);
  root.appendChild(body);

  return {
    root: root,
    show: (text) => {
      root.style.display = "block";
      body.textContent = text;
    },
    append: (text) => {
      root.style.display = "block";
      body.textContent = body.textContent + text;
    }
  };
}

function vanessaSetBusyUI(busy) {
  if (!vanessaSendBtn) return;
  vanessaSendBtn.textContent = busy ? "Stop" : "Ask";
  vanessaSendBtn.setAttribute("style", vanessaButtonStyle(!busy) + (busy ? "background:#b91c1c;border-color:#b91c1c;color:#ffffff;" : ""));
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
  overlay.setAttribute("data-vanessa", "1");
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
  const preview = { file: payload, page: vanessaPageContext(level) };

  const pre = vanessaEl(
    "pre",
    "background:#0f172a;color:#e2e8f0;border-radius:0.5rem;padding:0.75rem;font-size:0.6875rem;line-height:1.5;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:0 0 0.9rem;",
    JSON.stringify(preview, null, 2)
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

  card.appendChild(vanessaEl("h2", "font-family:Lora,Georgia,serif;font-size:1.15rem;color:#00133C;margin:0 0 0.35rem;", "What can Vanessa send?"));
  card.appendChild(
    vanessaEl(
      "p",
      "font-size:0.8125rem;color:#475569;margin:0 0 0.6rem;line-height:1.55;",
      "These levels control what Vanessa hands to a language model. Every level below stays on this computer. Nothing is sent over the internet and nothing is remembered after you close this tab. You can drop back down to the lowest level at any time."
    )
  );
  card.appendChild(
    vanessaEl(
      "p",
      "font-size:0.75rem;color:#475569;margin:0 0 1rem;line-height:1.55;border-left:3px solid #cbd5e1;padding-left:0.6rem;",
      "Separately from all of this, Vanessa can read the page you are looking at and work out what your results are saying. That reading and the arithmetic on it happen inside this tab, are shown only to you, and are never transmitted at any level. What the levels decide is how much of it a language model is allowed to be told."
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
        vanessaAppendMessage(
          "assistant",
          level === "offline"
            ? "Done, I've forgotten your data again. Back to answering from my notes only, and nothing leaves this tab."
            : `Got it, I can now see: ${VANESSA_LEVEL_LABELS[level].toLowerCase()}. ${VANESSA_LEVEL_BLURBS[level]} Change your mind whenever, it all resets when you close the tab anyway.`
        );
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

  const memoryBox = vanessaEl("div", "border-top:1px solid #e2e8f0;margin-top:0.8rem;padding-top:0.8rem;");
  memoryBox.appendChild(vanessaEl("p", "font-family:Lora,Georgia,serif;font-size:1rem;color:#00133C;margin:0 0 0.3rem;", "Remembering between visits"));
  memoryBox.appendChild(
    vanessaEl(
      "p",
      "font-size:0.75rem;color:#475569;margin:0 0 0.6rem;line-height:1.55;",
      "Everything above is forgotten the moment you close this tab. This is the one exception: anything you explicitly ask me to remember is written to this browser and survives a refresh. Your permission level is never part of that, so I always start back at the bottom and ask again."
    )
  );

  const remembered = vanessaMemoryFor(vanessaTool);

  const toggle = vanessaEl("button", vanessaButtonStyle(!vanessaMemoryOn), vanessaMemoryOn ? "Turn remembering off" : "Turn remembering on");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    vanessaMemoryOn = !vanessaMemoryOn;
    overlay.remove();
    vanessaShowConsent();
    vanessaAppendMessage(
      "assistant",
      vanessaMemoryOn
        ? "Right, I'll remember things now. Say \"remember that...\" and it sticks between visits. Nothing else gets written down."
        : "Remembering is off again. Anything already saved is still there until you delete it."
    );
  });
  memoryBox.appendChild(toggle);

  if (remembered.length > 0) {
    memoryBox.appendChild(vanessaEl("p", "font-size:0.6875rem;font-weight:700;color:#00133C;margin:0.8rem 0 0.35rem;text-transform:uppercase;letter-spacing:0.04em;", `Currently holding ${remembered.length}`));

    remembered.forEach((item, index) => {
      const row = vanessaEl("div", "display:flex;align-items:flex-start;gap:0.5rem;border:1px solid #e2e8f0;border-radius:0.5rem;padding:0.45rem 0.6rem;margin-bottom:0.35rem;");
      const text = vanessaEl("span", "flex:1;font-size:0.75rem;color:#334155;line-height:1.45;", item.text);
      const forget = vanessaEl("button", "border:none;background:transparent;color:#b91c1c;font-size:0.6875rem;font-weight:700;cursor:pointer;padding:0;", "Forget");
      forget.type = "button";
      forget.addEventListener("click", () => {
        vanessaMemoryForget(vanessaTool, index);
        overlay.remove();
        vanessaShowConsent();
      });
      row.appendChild(text);
      row.appendChild(forget);
      memoryBox.appendChild(row);
    });

    const wipe = vanessaEl("button", vanessaButtonStyle(false) + "margin-top:0.2rem;", "Forget everything");
    wipe.type = "button";
    wipe.addEventListener("click", () => {
      vanessaMemoryClear(vanessaTool);
      overlay.remove();
      vanessaShowConsent();
      vanessaAppendMessage("assistant", "All wiped. I don't know anything about you from before.");
    });
    memoryBox.appendChild(wipe);
  }

  card.appendChild(memoryBox);

  if (!vanessaBackend.available) {
    card.appendChild(
      vanessaEl(
        "p",
        "font-size:0.75rem;color:#475569;margin:0.8rem 0 0;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:0.7rem;",
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
  if (vanessaBusy) {
    if (vanessaAbort) vanessaAbort.abort();
    return;
  }

  const question = vanessaInputEl.value.trim();
  if (question === "") return;

  vanessaBusy = true;
  vanessaTurnCount++;
  vanessaInputEl.value = "";
  vanessaAppendMessage("user", question);

  const toRemember = vanessaMemoryCandidate(question);
  if (toRemember) {
    if (!vanessaMemoryOn) {
      vanessaAppendMessage(
        "assistant",
        "I can hold on to that, but remembering between visits is switched off by default. Turn it on under Change below and ask me again, and it will stick until you delete it."
      );
      vanessaBusy = false;
      return;
    }
    const saved = vanessaMemoryAdd(vanessaTool, toRemember);
    vanessaAppendMessage(
      "assistant",
      saved
        ? `Noted, and I'll still have that next time: "${saved}". You can see and delete everything I'm holding under Change.`
        : "I already had that one written down, so nothing new to add."
    );
    vanessaBusy = false;
    return;
  }

  const useModel = vanessaBackend.available && vanessaAtLeast("ask");

  if (!useModel) {
    const answer = vanessaOfflineAnswer(vanessaTool, question);
    vanessaAppendMessage("assistant", answer);
    vanessaHistory.push({ role: "user", content: question });
    vanessaHistory.push({ role: "assistant", content: answer });
    vanessaBusy = false;
    return;
  }

  const wrap = vanessaEl("div", "display:flex;flex-direction:column;align-items:flex-start;margin-bottom:0.6rem;");
  const think = vanessaBuildThinkingBlock();
  const bubble = vanessaEl(
    "div",
    "max-width:100%;border-radius:0.75rem;padding:0.55rem 0.75rem;font-size:0.8125rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:#f1f5f9;color:#00133C;border:1px solid #e2e8f0;",
    "typing..."
  );
  bubble.style.color = "#94a3b8";
  bubble.style.fontStyle = "italic";

  wrap.appendChild(think.root);
  wrap.appendChild(bubble);
  vanessaLogEl.appendChild(wrap);
  vanessaLogEl.scrollTop = vanessaLogEl.scrollHeight;

  vanessaAbort = new AbortController();
  vanessaSetBusyUI(true);

  let raw = "";
  let shownAnswer = false;

  const render = () => {
    const split = vanessaBackend.nativeThinking ? { thinking: "", answer: raw } : vanessaSplitThinking(raw);
    if (split.thinking.trim() !== "") think.show(split.thinking.trim());
    if (split.answer.trim() !== "") {
      if (!shownAnswer) {
        bubble.style.color = "#00133C";
        bubble.style.fontStyle = "normal";
        shownAnswer = true;
      }
      bubble.textContent = split.answer.trim();
    }
    vanessaLogEl.scrollTop = vanessaLogEl.scrollHeight;
  };

  try {
    const messages = vanessaBuildMessages(question);
    vanessaHistory.push({ role: "user", content: question });

    await vanessaBackendAsk(
      messages,
      (delta) => {
        raw += delta;
        render();
      },
      (thinkDelta) => think.append(thinkDelta),
      vanessaAbort.signal
    );

    const final = vanessaBackend.nativeThinking ? raw.trim() : vanessaSplitThinking(raw).answer.trim();

    if (final === "") {
      const fallback = raw.replace(/<\/?think>/g, "").trim();
      const answer = fallback === "" ? vanessaOfflineAnswer(vanessaTool, question) : fallback;
      bubble.style.color = "#00133C";
      bubble.style.fontStyle = "normal";
      bubble.textContent = answer;
      vanessaHistory.push({ role: "assistant", content: answer });
    } else {
      vanessaHistory.push({ role: "assistant", content: final });
    }
  } catch (e) {
    const stopped = e && e.name === "AbortError";
    const partial = vanessaSplitThinking(raw).answer.trim();
    bubble.style.color = "#00133C";
    bubble.style.fontStyle = "normal";
    if (stopped) {
      bubble.textContent = partial === "" ? "Stopped there." : partial + "\n\n(stopped)";
    } else {
      bubble.textContent = vanessaOfflineAnswer(vanessaTool, question);
    }
  }

  vanessaAbort = null;
  vanessaSetBusyUI(false);
  vanessaBusy = false;
  vanessaInputEl.focus();
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

  vanessaSendBtn = vanessaEl("button", vanessaButtonStyle(true), "Ask");
  vanessaSendBtn.type = "button";
  vanessaSendBtn.addEventListener("click", vanessaSend);

  inputRow.appendChild(vanessaInputEl);
  inputRow.appendChild(vanessaSendBtn);

  panel.setAttribute("data-vanessa", "1");
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
      vanessaAppendMessage("assistant", VANESSA_GREETING);
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
  launcher.setAttribute("data-vanessa", "1");
  launcher.addEventListener("click", () => vanessaToggle());

  vanessaPanelEl = vanessaBuildPanel();

  document.body.appendChild(vanessaPanelEl);
  document.body.appendChild(launcher);

  vanessaSetStatus();

  vanessaProbeBackend().then((result) => {
    vanessaBackend = result;
  });
}
