const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const shopifyStoreDomain = normalizeShopifyDomain(
  process.env.SHOPIFY_STORE_DOMAIN || "3standardstoppage.myshopify.com",
);
const shopifyAdminToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(requestUrl.pathname);

  if (requestedPath === "/api/shopify-inventory") {
    await handleShopifyInventoryRequest(requestUrl, response);
    return;
  }

  if (requestedPath === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  });
});

server.listen(port, () => {
  console.log(`Serving Bird Pit map on port ${port}`);
});

async function handleShopifyInventoryRequest(requestUrl, response) {
  if (!shopifyAdminToken) {
    sendJson(response, 503, {
      error: "Missing SHOPIFY_ADMIN_ACCESS_TOKEN environment variable.",
    });
    return;
  }

  const handles = (requestUrl.searchParams.get("handles") || "")
    .split(",")
    .map((handle) => handle.trim())
    .filter(Boolean)
    .slice(0, 80);

  if (!handles.length) {
    sendJson(response, 400, { error: "No product handles provided." });
    return;
  }

  try {
    const products = await fetchShopifyAdminInventory(handles);
    sendJson(response, 200, { products });
  } catch (error) {
    sendJson(response, 502, { error: error.message });
  }
}

async function fetchShopifyAdminInventory(handles) {
  const products = {};
  const chunkSize = 20;

  for (let start = 0; start < handles.length; start += chunkSize) {
    const chunk = handles.slice(start, start + chunkSize);
    const query = `query {
${chunk.map((handle, index) => `  product${index}: products(first: 1, query: ${JSON.stringify(`handle:${handle}`)}) {
    nodes {
      handle
      variants(first: 20) {
        nodes {
          availableForSale
          inventoryQuantity
          sellableOnlineQuantity
          inventoryItem {
            inventoryLevels(first: 20) {
              nodes {
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }`).join("\n")}
}`;

    const payload = await requestShopifyAdmin(query);

    chunk.forEach((handle, index) => {
      const product = payload.data?.[`product${index}`]?.nodes?.[0];
      const variants = product?.variants?.nodes || [];
      if (!variants.length) return;

      const availableQuantity = variants.reduce((total, variant) => {
        const levelQuantity = getInventoryLevelQuantity(variant);
        const quantity = Number.isFinite(levelQuantity)
          ? levelQuantity
          : Number(variant.sellableOnlineQuantity ?? variant.inventoryQuantity ?? 0);
        return total + (Number.isFinite(quantity) ? quantity : 0);
      }, 0);

      products[handle] = {
        availableForSale: variants.some((variant) => variant.availableForSale),
        availableQuantity,
        inventory: availableQuantity > 0 ? 1 : 0,
      };
    });
  }

  return products;
}

function getInventoryLevelQuantity(variant) {
  const levels = variant.inventoryItem?.inventoryLevels?.nodes || [];
  if (!levels.length) return null;

  return levels.reduce((total, level) => {
    const available = level.quantities?.find((quantity) => quantity.name === "available");
    return total + Number(available?.quantity || 0);
  }, 0);
}

async function requestShopifyAdmin(query) {
  const response = await fetch(`https://${shopifyStoreDomain}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shopifyAdminToken,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Shopify Admin responded with ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload;
}

function normalizeShopifyDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(JSON.stringify(payload));
}
