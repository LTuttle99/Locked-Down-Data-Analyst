const SANITIZE_ALLOWED_TAGS = new Set([
  "a", "b", "blockquote", "br", "caption", "code", "dd", "del", "div", "dl", "dt", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li", "ol",
  "p", "pre", "q", "s", "samp", "span", "strong", "sub", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul", "var"
]);

const SANITIZE_DROPPED_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "audio",
  "video", "source", "track", "form", "button", "select", "option", "optgroup", "textarea",
  "label", "fieldset", "legend", "noscript", "svg", "math", "link", "meta", "base",
  "template", "head", "title", "canvas", "portal", "dialog", "slot"
]);

const SANITIZE_ALLOWED_ATTRIBUTES = {
  "*": ["class", "lang", "dir", "title"],
  a: ["href"],
  img: ["src", "alt", "width", "height"],
  input: ["type", "checked", "disabled"],
  ol: ["start", "reversed"],
  td: ["colspan", "rowspan", "align"],
  th: ["colspan", "rowspan", "align", "scope"]
};

const SANITIZE_ALLOWED_URL_SCHEMES = new Set(["http", "https", "mailto", "tel", "ftp"]);

const SANITIZE_DATA_IMAGE_PATTERN = /^data:image\/(?:png|gif|jpeg|jpg|webp|bmp);base64,[a-z0-9+/=]*$/i;

function sanitizeUrlValue(value, allowDataImage) {
  const cleaned = String(value === null || value === undefined ? "" : value)
    .replace(/[\u0000-\u0020\u007f-\u00a0\u2028\u2029]/g, "");

  if (cleaned === "") return null;

  const scheme = cleaned.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!scheme) return cleaned;

  const name = scheme[1].toLowerCase();
  if (name === "data") return allowDataImage && SANITIZE_DATA_IMAGE_PATTERN.test(cleaned) ? cleaned : null;
  return SANITIZE_ALLOWED_URL_SCHEMES.has(name) ? cleaned : null;
}

function sanitizeAttributes(element, tag) {
  const allowed = new Set(SANITIZE_ALLOWED_ATTRIBUTES["*"].concat(SANITIZE_ALLOWED_ATTRIBUTES[tag] || []));

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();

    if (!allowed.has(name)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === "href" || name === "src") {
      const url = sanitizeUrlValue(attribute.value, tag === "img");
      if (url === null) element.removeAttribute(attribute.name);
      else element.setAttribute(attribute.name, url);
    }
  }

  if (tag === "a" && element.hasAttribute("href")) {
    element.setAttribute("rel", "noopener noreferrer nofollow");
  }

  if (tag === "input") {
    element.setAttribute("disabled", "");
  }
}

function sanitizeChildNodes(parent) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue;

    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      continue;
    }

    const tag = node.tagName.toLowerCase();

    if (SANITIZE_DROPPED_TAGS.has(tag)) {
      node.remove();
      continue;
    }

    if (tag === "input" && String(node.getAttribute("type") || "").toLowerCase() !== "checkbox") {
      node.remove();
      continue;
    }

    sanitizeChildNodes(node);

    if (!SANITIZE_ALLOWED_TAGS.has(tag)) {
      while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
      node.remove();
      continue;
    }

    sanitizeAttributes(node, tag);
  }
}

function sanitizeHtml(html) {
  const holder = document.createElement("template");
  holder.innerHTML = String(html === null || html === undefined ? "" : html);
  sanitizeChildNodes(holder.content);
  return holder.innerHTML;
}
