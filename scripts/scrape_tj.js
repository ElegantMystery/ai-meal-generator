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

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

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
    return [];
  }

  const items = [];

  // Walk the JSON tree looking for SimpleProduct nodes
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node.__typename === "SimpleProduct" && node.sku) {
      items.push(node);
      return; // don't recurse into the product itself
    }
    for (const val of Object.values(node)) {
      walk(val);
    }
  }

  walk(parsed);
  return items;
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
  let networkRequests = 0;
  let jsonResponses = 0;

  // Intercept all network responses and capture product JSON
  page.on("response", async (response) => {
    networkRequests++;
    const url = response.url();

    // TJ uses a GraphQL endpoint and/or REST under /api
    const isApiCall =
      url.includes("/graphql") ||
      url.includes("/api/") ||
      url.includes("traderjoes.com/home/products");

    if (!isApiCall) return;
    if (response.status() !== 200) return;

    const ct = response.headers()["content-type"] || "";
    if (!ct.includes("application/json") && !ct.includes("text/plain")) return;

    let body;
    try {
      body = await response.text();
    } catch (_) {
      return;
    }

    const extracted = parseGraphQLBody(body);
    if (extracted.length === 0) return;

    jsonResponses++;
    for (const raw of extracted) {
      const sku = String(raw.sku);
      if (!productsBySku.has(sku)) {
        productsBySku.set(sku, raw);
      }
    }
  });

  // Navigate to the product listing page
  console.log(`[scrape_tj] Navigating to ${START_URL}`);
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  // Wait for initial products to load
  await page.waitForTimeout(3000);

  // Click "Load more results" until it's gone or we hit MAX_CLICKS
  let clickCount = 0;
  let noNewProductsCount = 0;
  let endReason = "max_clicks";

  for (let i = 0; i < MAX_CLICKS; i++) {
    const countBefore = productsBySku.size;

    // Find the "Load more" button — TJ renders it as a <button> or <a>
    const loadMoreBtn = page
      .locator(
        'button:has-text("Load more"), ' +
          'a:has-text("Load more"), ' +
          '[data-testid="load-more"], ' +
          ".load-more-button",
      )
      .first();

    const isVisible = await loadMoreBtn.isVisible().catch(() => false);
    const isDisabled = isVisible
      ? await loadMoreBtn.isDisabled().catch(() => false)
      : false;

    if (!isVisible || isDisabled) {
      endReason = "load_more_disabled";
      console.log(
        `[scrape_tj] No more "Load more" button. Done after ${i} clicks.`,
      );
      break;
    }

    try {
      await loadMoreBtn.click();
      clickCount++;
    } catch (err) {
      console.warn(`[scrape_tj] Click failed: ${err.message}`);
      endReason = "click_error";
      break;
    }

    // Wait for network to settle after click; cap at 5s so a hung request
    // (e.g. stalled ad/analytics call) doesn't stall the entire loop.
    await page.waitForTimeout(2000);
    await Promise.race([
      page.waitForLoadState("networkidle"),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    const countAfter = productsBySku.size;
    if (countAfter === countBefore) {
      noNewProductsCount++;
      if (noNewProductsCount >= 3) {
        endReason = "no_new_products";
        console.log("[scrape_tj] No new products after 3 clicks. Stopping.");
        break;
      }
    } else {
      noNewProductsCount = 0;
    }

    if (i % 10 === 0) {
      console.log(
        `[scrape_tj] Click ${i + 1}: ${productsBySku.size} products collected`,
      );
    }
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
    endReason,
    scrollIterations: clickCount + 1,
    loadMoreClickedCount: clickCount,
    noNewProductsCount,
    startUrl: START_URL,
    timestamp: new Date().toISOString(),
    networkRequests,
    jsonResponses,
  };
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  console.log(`[scrape_tj] Metadata written to ${META_PATH}`);
  console.log("[scrape_tj] Done.");
}

main().catch((err) => {
  console.error("[scrape_tj] Fatal error:", err);
  process.exit(1);
});
