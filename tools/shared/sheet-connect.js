function googleSheetRefFromUrl(url) {
  const text = String(url || "").trim();
  if (text === "") return null;

  const published = text.match(/docs\.google\.com\/spreadsheets\/d\/e\/([\w-]+)/);
  if (published) {
    return { published: true, id: published[1], gid: googleSheetGidFromUrl(text) };
  }

  const standard = text.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (standard) {
    return { published: false, id: standard[1], gid: googleSheetGidFromUrl(text) };
  }

  if (/^[\w-]{20,}$/.test(text)) return { published: false, id: text, gid: null };

  return null;
}

function googleSheetGidFromUrl(url) {
  const match = String(url).match(/[#&?]gid=(\d+)/);
  return match ? match[1] : null;
}

function googleSheetCsvUrls(url) {
  const ref = googleSheetRefFromUrl(url);
  if (!ref) return [];

  const gid = ref.gid;
  const urls = [];

  if (ref.published) {
    urls.push(`https://docs.google.com/spreadsheets/d/e/${ref.id}/pub?${gid ? `gid=${gid}&` : ""}single=true&output=csv`);
    return urls;
  }

  urls.push(`https://docs.google.com/spreadsheets/d/${ref.id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ""}`);
  urls.push(`https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv${gid ? `&gid=${gid}` : ""}`);
  return urls;
}

function googleSheetLooksLikeHtml(text) {
  const head = String(text).slice(0, 400).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}

async function fetchGoogleSheet(url) {
  const candidates = googleSheetCsvUrls(url);

  if (candidates.length === 0) {
    throw new Error("That does not look like a Google Sheets link. Copy the URL from your browser address bar while the sheet is open.");
  }

  let lastProblem = "";

  for (const candidate of candidates) {
    let response;
    try {
      response = await fetch(candidate, { credentials: "omit", redirect: "follow" });
    } catch (e) {
      lastProblem = "blocked";
      continue;
    }

    if (!response.ok) {
      lastProblem = response.status === 401 || response.status === 403 ? "private" : "http";
      continue;
    }

    const text = await response.text();
    if (googleSheetLooksLikeHtml(text)) {
      lastProblem = "private";
      continue;
    }

    const parsed = parseCSVText(text);
    if (parsed.columns.length === 0) {
      lastProblem = "empty";
      continue;
    }

    return { ...parsed, csvUrl: candidate };
  }

  throw new Error(googleSheetProblemMessage(lastProblem));
}

function googleSheetProblemMessage(problem) {
  if (problem === "private" || problem === "blocked") {
    return "The sheet could not be read. In Google Sheets open Share and set General access to \"Anyone with the link\", or use File then Share then Publish to web.";
  }
  if (problem === "empty") return "The sheet was read but the tab appears to be empty.";
  return "The sheet could not be read. Check the link and that the sheet still exists.";
}

function googleSheetTabLabel(url) {
  const ref = googleSheetRefFromUrl(url);
  if (!ref) return "";
  return ref.gid ? `tab ${ref.gid}` : "first tab";
}
