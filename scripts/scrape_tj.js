"use strict";

/**
 * scrape_tj.js — Trader Joe's product catalog scraper
 *
 * Uses playwright-extra + stealth plugin to bypass bot detection.
 * Navigates to the TJ food category page, intercepts GraphQL API responses,
 * scrolls to trigger lazy-loading / "Load more" until exhausted,
 * then writes tj-items.json and tj-metadata.json.
 *
 * Usage:
 *   node scrape_tj.js [--output <path>] [--meta <path>]
 */

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");

// Apply all stealth evasions
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
const MAX_ITERS = 300;   // safety ceiling for scroll/click loop
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

function extractCategories(raw) {
  const hier = raw.category_hierarchy || [];
  return hier.slice(1).map((c) => c.name).join(" > ") || null;
}

function extractPrice(raw) {
  const retail = raw.retail_price;
  if (retail != null) {
    const n = parseFloat(retail);
    if (!isNaN(n)) return n;
  }
  try { return raw.price_range.minimum_price.final_price.value; } catch (_) {}
  return null;
}

function parseGraphQLBody(body) {
  let parsed;
  try { parsed = JSON.parse(body); } catch (_) { return []; }
  const items = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.__typename === "SimpleProduct" && node.sku) { items.push(node); return; }
    Object.values(node).forEach(walk);
  }
  walk(parsed);
  return items;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[scrape_tj] Starting with stealth mode. Output: ${OUTPUT_PATH}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  const productsBySku = new Map();
  let networkRequests = 0;
  let jsonResponses = 0;

  // Intercept GraphQL / API responses
  page.on("response", async (response) => {
    networkRequests++;
    const url = response.url();
    const isApi =
      url.includes("/graphql") ||
      url.includes("/api/") ||
      url.includes("traderjoes.com/home/products");
    if (!isApi) return;
    if (response.status() !== 200) return;
    const ct = response.headers()["content-type"] || "";
    if (!ct.includes("application/json") && !ct.includes("text/plain")) return;
    let body;
    try { body = await response.text(); } catch (_) { return; }
    const extracted = parseGraphQLBody(body);
    if (!extracted.length) return;
    jsonResponses++;
    for (const raw of extracted) {
      if (!productsBySku.has(String(raw.sku))) productsBySku.set(String(raw.sku), raw);
    }
  });

  console.log(`[scrape_tj] Navigating to ${START_URL}`);
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000); // let Akamai challenges resolve

  console.log(`[scrape_tj] Page loaded. Starting scroll/click loop...`);

  let noProgressCount = 0;
  let iterCount = 0;
  let endReason = "max_iters";

  for (let i = 0; i < MAX_ITERS; i++) {
    iterCount = i + 1;
    const countBefore = productsBySku.size;

    // Try clicking "Load more" button (text may vary)
    const loadMoreBtn = page.locator(
      'button:has-text("Load more"), ' +
      'a:has-text("Load more"), ' +
      '[data-testid="load-more"], ' +
      ".load-more-button, " +
      'button:has-text("Show more"), ' +
      'button:has-text("View more")'
    ).first();

    const isVisible = await loadMoreBtn.isVisible().catch(() => false);
    if (isVisible) {
      const isDisabled = await loadMoreBtn.isDisabled().catch(() => false);
      if (!isDisabled) {
        try { await loadMoreBtn.click(); } catch (_) {}
      }
    } else {
      // Scroll to bottom to trigger infinite scroll / lazy loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }

    await page.waitForTimeout(2000);
    await Promise.race([
      page.waitForLoadState("networkidle"),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    const countAfter = productsBySku.size;

    if (i % 10 === 0) {
      console.log(`[scrape_tj] Iter ${i + 1}: ${productsBySku.size} products, ${networkRequests} net reqs, ${jsonResponses} JSON responses`);
    }

    if (countAfter === countBefore) {
      noProgressCount++;
      if (noProgressCount >= 5) {
        endReason = "no_new_products";
        console.log(`[scrape_tj] No new products after 5 iters. Done at iter ${i + 1}.`);
        break;
      }
    } else {
      noProgressCount = 0;
    }
  }

  await browser.close();

  console.log(`[scrape_tj] Loop ended (${endReason}). Building output...`);
  console.log(`[scrape_tj] Network requests: ${networkRequests}, JSON responses: ${jsonResponses}`);

  const items = [];
  for (const [sku, raw] of productsBySku) {
    items.push({
      store: "TRADER_JOES",
      sku,
      name: raw.item_title || raw.name || null,
      price: extractPrice(raw),
      weight: null,
      categories: extractCategories(raw),
      nutrition: raw.nutritional_info || raw.nutrition_text || null,
      ingredients: raw.ingredients || null,
      raw,
    });
  }

  if (items.length < 100) {
    console.error(
      `[scrape_tj] ERROR: Only ${items.length} items collected — ` +
      "expected at least 100. Stealth evasion may have failed. Exiting."
    );
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2), "utf8");
  console.log(`[scrape_tj] Wrote ${items.length} items to ${OUTPUT_PATH}`);

  const meta = {
    totalProducts: items.length,
    endReason,
    iterations: iterCount,
    networkRequests,
    jsonResponses,
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
