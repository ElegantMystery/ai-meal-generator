"use strict";

/**
 * scrape_tj.js — Trader Joe's product catalog scraper
 *
 * Strategy:
 *  1. Launch stealth Chromium and navigate to TJ's food category page.
 *  2. Use page.route to intercept TJ's own GraphQL request and capture
 *     its URL, headers, and body (including session cookies + any nonces).
 *  3. Use page.evaluate to replay that exact request for every subsequent
 *     page from within the browser context — so Akamai sees legitimate
 *     browser traffic with valid session state, not raw Node.js fetches.
 *  4. Fall back to scroll/click loop if no GraphQL request was captured.
 *
 * Usage:
 *   node scrape_tj.js [--output <path>] [--meta <path>]
 */

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
const MAX_FALLBACK_ITERS = 150;
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
  } catch (_) {}
  return null;
}

/**
 * Walk a parsed JSON object and collect SimpleProduct nodes + page_info.
 */
function parseGraphQLBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
    return { items: [], pageInfo: null };
  }

  const items = [];
  let pageInfo = null;

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.__typename === "SimpleProduct" && node.sku) {
      items.push(node);
      return;
    }
    if (!pageInfo && node.page_info && node.page_info.total_pages) {
      pageInfo = node.page_info;
    }
    Object.values(node).forEach(walk);
  }
  walk(parsed);
  return { items, pageInfo };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[scrape_tj] Starting. Output: ${OUTPUT_PATH}`);

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

  // Forward browser console errors to Node.js stdout for debugging
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[browser-err] ${msg.text()}`);
    }
  });

  const productsBySku = new Map();
  let capturedGQLRequest = null; // { url, headers, body: parsed }
  let capturedPageInfo = null; // { current_page, page_size, total_pages }

  // Capture TJ's own GraphQL request for pagination replay
  await page.route("**graphql**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && !capturedGQLRequest) {
      const rawBody = request.postData();
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody);
          if (parsed.variables && parsed.query) {
            capturedGQLRequest = {
              url: request.url(),
              headers: request.headers(),
              body: parsed,
            };
            console.log(`[scrape_tj] Captured GQL request → ${request.url()}`);
            console.log(
              `[scrape_tj] GQL variable keys: ${Object.keys(parsed.variables).join(", ")}`,
            );
          }
        } catch (_) {}
      }
    }
    await route.continue();
  });

  // Intercept responses to collect first-page products + page_info
  page.on("response", async (response) => {
    const url = response.url();
    const isApi = url.includes("graphql") || url.includes("/api/");
    if (!isApi) return;
    if (response.status() !== 200) {
      if (url.includes("graphql")) {
        console.log(`[scrape_tj] GraphQL HTTP ${response.status()} ← ${url}`);
      }
      return;
    }
    const ct = response.headers()["content-type"] || "";
    if (!ct.includes("application/json") && !ct.includes("text/plain")) return;
    let rawBody;
    try {
      rawBody = await response.text();
    } catch (_) {
      return;
    }

    const { items, pageInfo } = parseGraphQLBody(rawBody);
    for (const raw of items) {
      if (!productsBySku.has(String(raw.sku)))
        productsBySku.set(String(raw.sku), raw);
    }
    if (pageInfo && !capturedPageInfo) {
      capturedPageInfo = pageInfo;
      console.log(
        `[scrape_tj] Page info: ${pageInfo.current_page}/${pageInfo.total_pages} (size=${pageInfo.page_size})`,
      );
    }
  });

  console.log(`[scrape_tj] Navigating to ${START_URL}`);
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000); // let Akamai challenges + initial GQL load complete

  // Unregister route handler — no longer needed after initial load
  await page.unroute("**graphql**");

  console.log(`[scrape_tj] After initial load: ${productsBySku.size} products`);

  // ---------------------------------------------------------------------------
  // Strategy A: In-browser GraphQL pagination (preferred)
  //
  // We replay TJ's own captured GraphQL request from within the browser's
  // JavaScript context via page.evaluate. Akamai sees an in-page fetch with
  // valid cookies + the same TLS fingerprint as the initial load — not a raw
  // Node.js connection from a datacenter IP.
  // ---------------------------------------------------------------------------
  if (
    capturedGQLRequest &&
    capturedPageInfo &&
    capturedPageInfo.total_pages > 1
  ) {
    const totalPages = capturedPageInfo.total_pages;
    console.log(
      `[scrape_tj] Paginating ${totalPages} pages via in-browser fetch...`,
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
              // Handle both currentPage and page variable names
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
            console.log(
              `[scrape_tj] Page ${p}/${endPage}: +${collected.length - sizeBefore} items (total ${collected.length})`,
            );
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
      `[scrape_tj] In-browser pagination: ${moreItems.length} additional items`,
    );
    for (const raw of moreItems) {
      if (!productsBySku.has(String(raw.sku)))
        productsBySku.set(String(raw.sku), raw);
    }

    // ---------------------------------------------------------------------------
    // Strategy B: Scroll / "Load more" fallback
    // ---------------------------------------------------------------------------
  } else {
    if (!capturedGQLRequest) {
      console.log(
        "[scrape_tj] No GQL request captured — falling back to scroll/click loop",
      );
    } else {
      console.log(
        "[scrape_tj] Single page or no page_info — scroll/click loop",
      );
    }

    let noProgressCount = 0;

    for (let i = 0; i < MAX_FALLBACK_ITERS; i++) {
      const countBefore = productsBySku.size;

      const loadMoreBtn = page
        .locator(
          'button:has-text("Load more"), a:has-text("Load more"), ' +
            '[data-testid="load-more"], .load-more-button, ' +
            'button:has-text("Show more"), button:has-text("View more")',
        )
        .first();

      const isVisible = await loadMoreBtn.isVisible().catch(() => false);
      if (isVisible) {
        const isDisabled = await loadMoreBtn.isDisabled().catch(() => false);
        if (!isDisabled) {
          try {
            await loadMoreBtn.click();
          } catch (_) {}
        }
      } else {
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
      }

      await page.waitForTimeout(3000);
      await Promise.race([
        page.waitForLoadState("networkidle"),
        new Promise((r) => setTimeout(r, 6000)),
      ]);

      const countAfter = productsBySku.size;

      if (i % 10 === 0) {
        console.log(
          `[scrape_tj] Scroll iter ${i + 1}: ${productsBySku.size} products`,
        );
      }

      if (countAfter === countBefore) {
        noProgressCount++;
        if (noProgressCount >= 8) {
          console.log(
            `[scrape_tj] No new products for 8 iters. Done at iter ${i + 1}.`,
          );
          break;
        }
      } else {
        noProgressCount = 0;
      }
    }
  }

  await browser.close();

  // ---------------------------------------------------------------------------
  // Build and write output
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
      nutrition: raw.nutritional_info || raw.nutrition_text || null,
      ingredients: raw.ingredients || null,
      raw,
    });
  }

  console.log(`[scrape_tj] Total items collected: ${items.length}`);

  if (items.length < 100) {
    console.error(
      `[scrape_tj] ERROR: Only ${items.length} items — expected at least 100. Exiting.`,
    );
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2), "utf8");
  console.log(`[scrape_tj] Wrote ${items.length} items to ${OUTPUT_PATH}`);

  const meta = {
    totalProducts: items.length,
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
