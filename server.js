const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 8080;
const rootDirectory = __dirname;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

function sendResponse(response, statusCode, contentType, content) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });

  response.end(content);
}

function resolveRequestedFile(requestUrl) {
  const rawPath = decodeURIComponent(requestUrl.split("?")[0]);
  const requestedPath = rawPath === "/" ? "/index.html" : rawPath;
  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.resolve(rootDirectory, `.${path.sep}${normalizedPath}`);

  if (!absolutePath.startsWith(path.resolve(rootDirectory))) {
    return null;
  }

  return absolutePath;
}

const server = http.createServer((request, response) => {
  let filePath;

  try {
    filePath = resolveRequestedFile(request.url || "/");
  } catch {
    sendResponse(response, 400, "text/plain; charset=utf-8", "Bad request");
    return;
  }

  if (!filePath) {
    sendResponse(response, 403, "text/plain; charset=utf-8", "Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (!statError && stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    fs.readFile(filePath, (readError, content) => {
      if (!readError) {
        const extension = path.extname(filePath).toLowerCase();
        const contentType =
          mimeTypes[extension] || "application/octet-stream";

        sendResponse(response, 200, contentType, content);
        return;
      }

      if (readError.code !== "ENOENT") {
        sendResponse(
          response,
          500,
          "text/plain; charset=utf-8",
          "Internal server error"
        );
        return;
      }

      /*
       * Fallback to index.html so browser routes can still load.
       * Real missing files with extensions return 404 instead.
       */
      if (path.extname(filePath)) {
        sendResponse(response, 404, "text/plain; charset=utf-8", "Not found");
        return;
      }

      const fallbackPath = path.join(rootDirectory, "index.html");

      fs.readFile(fallbackPath, (fallbackError, fallbackContent) => {
        if (fallbackError) {
          sendResponse(
            response,
            404,
            "text/plain; charset=utf-8",
            "Not found"
          );
          return;
        }

        sendResponse(
          response,
          200,
          "text/html; charset=utf-8",
          fallbackContent
        );
      });
    });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Locked-Down Data Analyst is running on port ${port}`);
});
