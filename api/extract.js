/**
 * Vercel serverless product extractor.
 * Runs on the server → no browser CORS. Works for Daraz, Amazon, etc.
 *
 * GET /api/extract?url=https://...
 * POST /api/extract  { "url": "https://..." }
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
]);

function isPrivateIp(hostname) {
  if (BLOCKED_HOSTS.has(hostname)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(hostname)) return true;
  if (/^\[?fc/i.test(hostname) || /^\[?fd/i.test(hostname) || /^\[?fe80/i.test(hostname))
    return true;
  return false;
}

function decodeEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, prop) {
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`,
    "i",
  );
  return html.match(re1)?.[1] || html.match(re2)?.[1] || "";
}

function parseJsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const raw = m[1].trim();
      if (!raw) continue;
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const type = node["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.some((t) => /Product/i.test(String(t || "")))) out.push(node);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function priceFromOffers(offers) {
  if (!offers) return "";
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (!o) continue;
    const p = o.price ?? o.lowPrice ?? o.highPrice;
    if (p != null && p !== "") return String(p);
  }
  return "";
}

function imageFromJsonLd(image) {
  if (!image) return "";
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    const first = image[0];
    if (typeof first === "string") return first;
    return first?.url || first?.contentUrl || "";
  }
  return image.url || image.contentUrl || "";
}

function extractProduct(html) {
  const jsonLd = parseJsonLdProducts(html)[0];

  let title =
    (jsonLd && (jsonLd.name || jsonLd.title)) ||
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    "";

  let desc =
    (jsonLd && (jsonLd.description || jsonLd.about)) ||
    metaContent(html, "og:description") ||
    metaContent(html, "description") ||
    metaContent(html, "twitter:description") ||
    "";

  let image =
    (jsonLd && imageFromJsonLd(jsonLd.image)) ||
    metaContent(html, "og:image") ||
    metaContent(html, "og:image:secure_url") ||
    metaContent(html, "twitter:image") ||
    "";

  let priceRaw =
    (jsonLd && priceFromOffers(jsonLd.offers)) ||
    metaContent(html, "product:price:amount") ||
    metaContent(html, "og:price:amount") ||
    metaContent(html, "twitter:data1") ||
    "";

  if (!priceRaw) {
    const bodyPrice = html.match(
      /(?:Rs\.?|PKR|USD|INR|AED|\$|€|£)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i,
    );
    if (bodyPrice) priceRaw = bodyPrice[1];
  }

  // Daraz-style embedded JSON sometimes carries price
  if (!priceRaw) {
    const daraz = html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i);
    if (daraz) priceRaw = daraz[1];
  }

  const price =
    String(priceRaw)
      .replace(/,/g, "")
      .match(/(\d+(?:\.\d+)?)/)?.[1] || "";

  title = decodeEntities(String(title)).slice(0, 200);
  desc = decodeEntities(String(desc)).slice(0, 800);
  image = decodeEntities(String(image));

  // Resolve protocol-relative images
  if (image.startsWith("//")) image = `https:${image}`;

  const pcsMatch = `${title} ${desc}`.match(
    /(\d+)\s*(?:pcs|pieces|pack|ct|count|-pack|pc\b)/i,
  );

  return {
    title,
    description: desc,
    image,
    price,
    pcs: pcsMatch?.[1] || null,
  };
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) {
      const err = new Error(`Upstream returned ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const contentType = res.headers.get("content-type") || "";
    if (!/html|text|xml|json/i.test(contentType) && contentType) {
      // still try — some CDNs omit content-type
    }
    const text = await res.text();
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function validateUrl(raw) {
  let normalized = String(raw || "").trim();
  if (!normalized) throw Object.assign(new Error("Missing url"), { status: 400 });
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw Object.assign(new Error("Invalid URL"), { status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("Only http(s) URLs allowed"), { status: 400 });
  }
  if (isPrivateIp(parsed.hostname)) {
    throw Object.assign(new Error("That host is not allowed"), { status: 400 });
  }
  // Strip tracking junk that can break some CDNs
  ["pvid", "spm", "scm", "search", "clickTrackInfo", "exlaz"].forEach((k) =>
    parsed.searchParams.delete(k),
  );
  return parsed.toString();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const bodyUrl =
      req.method === "POST" && req.body
        ? typeof req.body === "string"
          ? JSON.parse(req.body).url
          : req.body.url
        : null;
    const raw = bodyUrl || req.query?.url;
    const url = validateUrl(raw);
    const html = await fetchHtml(url);
    const product = extractProduct(html);
    const filled = Boolean(product.title || product.price || product.image);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.end(
      JSON.stringify({
        ok: filled,
        url,
        ...product,
      }),
    );
  } catch (err) {
    const status = err.status && Number.isInteger(err.status) ? err.status : 502;
    res.statusCode = status >= 400 && status < 600 ? status : 502;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        error: err.name === "AbortError" ? "Timed out reading page" : err.message || "Extract failed",
      }),
    );
  }
};
