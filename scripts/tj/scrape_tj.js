/**
 * scrape_tj.js — Trader Joe's product catalog scraper
 *
 * Navigates to the TJ food category page, intercepts GraphQL API responses
 * that contain product data, clicks "Load more results" until exhausted,
 * then writes tj-items.json and tj-metadata.json.
 *
 * Usage:
 *   node scrape_tj.js [--output <path>] [--meta <path>]
 *
 * Defaults:
 *   --output  ./tj-items.json
 *   --meta    ./tj-metadata.json
 */

"use strict";

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");

chromium.use(StealthPlugin());

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const OUTPUT_PATH = getArg("--output", path.join(__dirname, "tj-items.json"));
const META_PATH = getArg("--meta", path.join(__dirname, "tj-metadata.json"));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const START_URL = "https://www.traderjoes.com/home/products/category/food-8";
const TJ_BASE = "https://www.traderjoes.com";
const MAX_CLICKS = 200; // safety ceiling — TJ has ~1300 items, ~85 pages
const PAGE_TIMEOUT = 60_000;
const NAV_TIMEOUT = 90_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toAbsUrl(p) {
  if (!p) return null;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  return TJ_BASE + (p.startsWith("/") ? p : "/" + p);
}

function extractImageUrl(raw) {
  const pim = raw.primary_image_meta || {};
  return toAbsUrl(pim.url || raw.primary_image || null);
}

function extractCategories(raw) {
  const hier = raw.category_hierarchy || [];
  // Skip the first entry ("Products") — start from "Food"
  return (
    hier
      .slice(1)
      .map((c) => c.name)
      .join(" > ") || null
  );
}

function extractPrice(raw) {
  const retail = raw.retail_price;
  if (retail != null) {
    const n = parseFloat(retail);
    if (!isNaN(n)) return n;
  }
  try {
    return raw.price_range.minimum_price.final_price.value;
  } catch (_) {
    return null;
  }
}

function extractNutrition(raw) {
  // TJ embeds nutrition as a text block in `nutritional_info` or similar fields
  return raw.nutritional_info || raw.nutrition_text || null;
}

function extractIngredients(raw) {
  return raw.ingredients || null;
}

function extractTags(raw) {
  const tags = [];
  for (const t of raw.fun_tags || []) {
    if (typeof t === "string" && t.trim()) tags.push(t.trim());
  }
  for (const t of raw.item_characteristics || []) {
    if (typeof t === "string" && t.trim()) tags.push(t.trim());
  }
  return tags;
}

/**
 * Parse a GraphQL response body and extract SimpleProduct records.
 * Returns an array of normalised item objects (may be empty).
 */
function parseGraphQLBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
    return { items: [], pageInfo: null, totalCount: null };
  }

  const items = [];
  let pageInfo = null;
  let totalCount = null;

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node.__typename === "SimpleProduct" && node.sku) {
      items.push(node);
      return;
    }
    if (!pageInfo && node.page_info && node.page_info.total_pages) {
      pageInfo = node.page_info;
    }
    if (totalCount === null && node.total_count != null) {
      totalCount = node.total_count;
    }
    for (const val of Object.values(node)) {
      walk(val);
    }
  }

  walk(parsed);
  return { items, pageInfo, totalCount };
}

// ---------------------------------------------------------------------------
// Build a product detail URL key from item_title + sku.
// Matches the slug format TJ uses: "ranch-flavored-rolled-corn-torilla-chips-083292"
// ---------------------------------------------------------------------------
function makeUrlKey(itemTitle, sku) {
  const slug = (itemTitle || "")
    .toLowerCase()
    .normalize("NFD") // decompose accented chars (é → e + ́)
    .replace(/[\u0300-\u036f]/g, "") // strip accent marks
    .replace(/&/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-${sku}` : String(sku);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[scrape_tj] Starting. Output: ${OUTPUT_PATH}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  // Collect raw product objects keyed by SKU (deduplication)
  const productsBySku = new Map();
  let capturedGQLRequest = null; // { url, headers, body }
  let capturedPageInfo = null;
  let capturedTotalCount = null;

  // Intercept GQL responses: collect products and capture the request template
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/graphql") && !url.includes("/api/")) return;
    if (response.status() !== 200) return;

    const ct = response.headers()["content-type"] || "";
    if (!ct.includes("application/json") && !ct.includes("text/plain")) return;

    let body;
    try {
      body = await response.text();
    } catch (_) {
      return;
    }

    const { items, pageInfo, totalCount } = parseGraphQLBody(body);
    for (const raw of items) {
      if (!productsBySku.has(String(raw.sku)))
        productsBySku.set(String(raw.sku), raw);
    }

    if (totalCount !== null && capturedTotalCount === null)
      capturedTotalCount = totalCount;

    // Capture the request template from the first response that has products
    if (items.length > 0 && !capturedGQLRequest) {
      const req = response.request();
      if (req.method() === "POST") {
        const rawReqBody = req.postData();
        if (rawReqBody) {
          try {
            capturedGQLRequest = {
              url: req.url(),
              headers: req.headers(),
              body: JSON.parse(rawReqBody),
            };
            capturedPageInfo = pageInfo;
            console.log(
              `[scrape_tj] GQL template captured: ${items.length} items, ` +
                `pageInfo=${JSON.stringify(pageInfo)}, totalCount=${totalCount}`,
            );
          } catch (_) {}
        }
      }
    }
  });

  // Navigate to the product listing page
  console.log(`[scrape_tj] Navigating to ${START_URL}`);
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  // Wait for Akamai challenge + initial products to load
  await page.waitForTimeout(8000);

  // Dismiss cookie banner and email overlay before paginating
  const gotIt = page
    .locator('button:has-text("GOT IT"), button:has-text("Got it")')
    .first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click().catch(() => {});
    console.log("[scrape_tj] Dismissed cookie banner");
    await page.waitForTimeout(1000);
  }
  await page.keyboard.press("Escape"); // close any modal/overlay

  // ---------------------------------------------------------------------------
  // Paginate via in-browser GQL replay
  //
  // We replay TJ's own captured GraphQL request from within the browser's JS
  // context so Akamai sees an in-page fetch with valid cookies + TLS fingerprint.
  // ---------------------------------------------------------------------------
  if (!capturedGQLRequest) {
    console.log(
      "[scrape_tj] WARNING: No GQL request captured — cannot paginate.",
    );
  } else {
    // Determine total pages: prefer page_info, fall back to total_count / page_size
    let totalPages = capturedPageInfo ? capturedPageInfo.total_pages : null;
    if (!totalPages && capturedTotalCount) {
      const pageSize = capturedPageInfo ? capturedPageInfo.page_size : 15;
      totalPages = Math.ceil(capturedTotalCount / pageSize);
    }
    if (!totalPages) {
      totalPages = 100; // blind upper bound — stop when 0 new items
      console.log(
        "[scrape_tj] No total_pages known — paginating blindly up to 100 pages",
      );
    }

    console.log(
      `[scrape_tj] Paginating ${totalPages} pages via in-browser GQL fetch...`,
    );

    // Only forward app-level headers; cookies are sent automatically
    const safeHeaders = {};
    for (const h of [
      "store",
      "content-currency",
      "x-magento-cache-id",
      "x-requested-with",
    ]) {
      if (capturedGQLRequest.headers[h])
        safeHeaders[h] = capturedGQLRequest.headers[h];
    }

    const moreItems = await page.evaluate(
      async ({ gqlUrl, extraHeaders, gqlBody, startPage, endPage }) => {
        const collected = [];

        function walk(node) {
          if (!node || typeof node !== "object") return;
          if (Array.isArray(node)) {
            node.forEach(walk);
            return;
          }
          if (node.__typename === "SimpleProduct" && node.sku) {
            collected.push(node);
            return;
          }
          Object.values(node).forEach(walk);
        }

        for (let p = startPage; p <= endPage; p++) {
          try {
            const body = JSON.parse(JSON.stringify(gqlBody));
            if (body.variables) {
              if ("currentPage" in body.variables)
                body.variables.currentPage = p;
              else if ("page" in body.variables) body.variables.page = p;
              else if ("pageNumber" in body.variables)
                body.variables.pageNumber = p;
            }

            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 30_000);
            let resp;
            try {
              resp = await fetch(gqlUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  ...extraHeaders,
                },
                body: JSON.stringify(body),
                credentials: "include",
                signal: ac.signal,
              });
            } finally {
              clearTimeout(timer);
            }

            if (!resp.ok) {
              console.log(`[scrape_tj] Page ${p}: HTTP ${resp.status}`);
              if (resp.status === 403) break;
              continue;
            }

            const data = await resp.json();
            const sizeBefore = collected.length;
            walk(data);
            const added = collected.length - sizeBefore;
            console.log(
              `[scrape_tj] Page ${p}/${endPage}: +${added} items (total ${collected.length})`,
            );
            if (added === 0 && p > startPage) break; // ran out of pages
          } catch (e) {
            console.log(`[scrape_tj] Page ${p} error: ${e.message}`);
          }
        }

        return collected;
      },
      {
        gqlUrl: capturedGQLRequest.url,
        extraHeaders: safeHeaders,
        gqlBody: capturedGQLRequest.body,
        startPage: 2,
        endPage: totalPages,
      },
    );

    console.log(
      `[scrape_tj] GQL pagination: ${moreItems.length} additional items`,
    );
    for (const raw of moreItems) {
      if (!productsBySku.has(String(raw.sku)))
        productsBySku.set(String(raw.sku), raw);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Enrich products with nutrition / ingredients from detail pages.
  //
  // We navigate to one product detail page so the browser makes a GQL request
  // with url_key in the variables. We capture that template, then replay it
  // in-browser (5 concurrent fetches) for every product — Akamai sees valid
  // cookies + TLS fingerprint so datacenter IPs are not blocked.
  // ---------------------------------------------------------------------------
  console.log(
    `[scrape_tj] Phase 2: enriching ${productsBySku.size} products with nutrition/ingredients...`,
  );

  let detailGQLRequest = null;
  const captureDetailGQL = async (response) => {
    if (detailGQLRequest) return;
    const url = response.url();
    if (!url.includes("/graphql")) return;
    if (response.status() !== 200) return;
    const req = response.request();
    if (req.method() !== "POST") return;
    let rawBody;
    try {
      rawBody = req.postData() || "";
    } catch (_) {
      return;
    }
    if (!rawBody.includes("url_key")) return;
    try {
      const reqBody = JSON.parse(rawBody);
      detailGQLRequest = {
        url: req.url(),
        headers: req.headers(),
        body: reqBody,
      };
      console.log(
        `[scrape_tj] Product detail GQL template captured. variables=${JSON.stringify(reqBody.variables)}`,
      );
    } catch (_) {}
  };
  page.on("response", captureDetailGQL);

  const [[firstSkuForDetail, firstRawForDetail]] = productsBySku.entries();
  const firstUrlKey = makeUrlKey(
    firstRawForDetail.item_title,
    firstSkuForDetail,
  );
  console.log(
    `[scrape_tj] Navigating to first product detail page: /pdp/${firstUrlKey}`,
  );
  try {
    await page.goto(`${TJ_BASE}/home/products/pdp/${firstUrlKey}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(6000);
  } catch (err) {
    console.log(`[scrape_tj] Detail page navigation error: ${err.message}`);
  }
  page.off("response", captureDetailGQL);

  if (!detailGQLRequest) {
    console.log(
      "[scrape_tj] WARNING: Could not capture product detail GQL. Nutrition/ingredients will be empty.",
    );
  } else {
    // Forward the same app-level headers used for listing pagination
    const detailSafeHeaders = {};
    for (const h of [
      "store",
      "content-currency",
      "x-magento-cache-id",
      "x-requested-with",
    ]) {
      if (detailGQLRequest.headers[h])
        detailSafeHeaders[h] = detailGQLRequest.headers[h];
    }

    const enrichItems = [...productsBySku.entries()].map(([sku, raw]) => ({
      sku,
      urlKey: makeUrlKey(raw.item_title, sku),
    }));

    const CHUNK = 100; // products per page.evaluate() call (~12s per chunk at 5 concurrent)
    const CONCURRENCY = 5;
    let totalEnriched = 0;

    // Disable evaluate() timeout for long-running enrichment chunks
    page.setDefaultTimeout(0);

    for (let i = 0; i < enrichItems.length; i += CHUNK) {
      const chunk = enrichItems.slice(i, i + CHUNK);

      const chunkResults = await page.evaluate(
        async ({ gqlUrl, extraHeaders, gqlBody, items, concurrency }) => {
          const results = {};

          async function fetchOne({ sku, urlKey }) {
            const body = JSON.parse(JSON.stringify(gqlBody));
            // TJ's product detail GQL uses variables.sku — NOT url_key.
            // url_key appears in the GQL query text as a fetched field, which
            // is why rawBody.includes("url_key") matched, but the per-product
            // variable to substitute is sku.
            if (body.variables) {
              if ("sku" in body.variables) body.variables.sku = sku;
              else if ("url_key" in body.variables)
                body.variables.url_key = urlKey;
              else if ("urlKey" in body.variables)
                body.variables.urlKey = urlKey;
            }
            try {
              const resp = await fetch(gqlUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  ...extraHeaders,
                },
                body: JSON.stringify(body),
                credentials: "include",
              });
              if (!resp.ok) return;
              const data = await resp.json();
              (function walk(node) {
                if (!node || typeof node !== "object") return;
                if (Array.isArray(node)) {
                  node.forEach(walk);
                  return;
                }
                if (node.__typename === "SimpleProduct" && node.sku) {
                  results[node.sku] = {
                    nutritional_info: node.nutritional_info || null,
                    ingredients: node.ingredients || null,
                  };
                  return;
                }
                Object.values(node).forEach(walk);
              })(data);
            } catch (_) {}
          }

          // Process with concurrency cap
          for (let j = 0; j < items.length; j += concurrency) {
            await Promise.all(items.slice(j, j + concurrency).map(fetchOne));
            await new Promise((r) => setTimeout(r, 100));
          }
          return results;
        },
        {
          gqlUrl: detailGQLRequest.url,
          extraHeaders: detailSafeHeaders,
          gqlBody: detailGQLRequest.body,
          items: chunk,
          concurrency: CONCURRENCY,
        },
      );

      for (const { sku } of chunk) {
        const detail = chunkResults[sku];
        if (detail) {
          const raw = productsBySku.get(sku);
          if (raw) {
            raw.nutritional_info = detail.nutritional_info;
            raw.ingredients = detail.ingredients;
            if (detail.nutritional_info || detail.ingredients) totalEnriched++;
          }
        }
      }
      console.log(
        `[scrape_tj] Enrichment: ${Math.min(i + CHUNK, enrichItems.length)}/${enrichItems.length} processed`,
      );
    }

    page.setDefaultTimeout(PAGE_TIMEOUT); // restore
    console.log(
      `[scrape_tj] Enrichment complete: ${totalEnriched}/${productsBySku.size} products have nutrition/ingredients`,
    );
  }

  await browser.close();

  // ---------------------------------------------------------------------------
  // Build output array in the format import_tj.py expects
  // ---------------------------------------------------------------------------
  const items = [];
  for (const [sku, raw] of productsBySku) {
    items.push({
      store: "TRADER_JOES",
      sku,
      name: raw.item_title || raw.name || null,
      price: extractPrice(raw),
      weight: null,
      categories: extractCategories(raw),
      nutrition: extractNutrition(raw),
      ingredients: extractIngredients(raw),
      raw,
    });
  }

  // Sanity check
  if (items.length < 100) {
    console.error(
      `[scrape_tj] ERROR: Only ${items.length} items collected — ` +
        "expected at least 100. Possible site change or block. Exiting with error.",
    );
    process.exit(1);
  }

  // Write items
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2), "utf8");
  console.log(`[scrape_tj] Wrote ${items.length} items to ${OUTPUT_PATH}`);

  // Write metadata
  const meta = {
    totalProducts: items.length,
    startUrl: START_URL,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  console.log(`[scrape_tj] Metadata written to ${META_PATH}`);
  console.log("[scrape_tj] Done.");
}

main().catch((err) => {
  console.error("[scrape_tj] Fatal error:", err);
  process.exit(1);
});
