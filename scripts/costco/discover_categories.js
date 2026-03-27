/**
 * discover_categories.js — Costco API reconnaissance tool
 *
 * Navigates to Costco food/grocery category pages, intercepts all XHR/fetch
 * responses, and logs the API URL patterns + response shapes to stdout so we
 * can build the real scraper against confirmed endpoints.
 *
 * Usage:
 *   node discover_categories.js
 *
 * Output: JSON summary of discovered endpoints + sample product shapes written
 * to stdout (redirect to discover-output.json to save).
 */

"use strict";

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const CATEGORIES = [
  "https://www.costco.com/grocery-household.html",
  "https://www.costco.com/snacks.html",
  "https://www.costco.com/beverages-water.html",
  "https://www.costco.com/pantry-canned-goods.html",
  "https://www.costco.com/frozen-foods.html",
  "https://www.costco.com/dairy-eggs.html",
  "https://www.costco.com/breakfast-cereals-spreads.html",
  "https://www.costco.com/bakery-desserts.html",
  "https://www.costco.com/meat-seafood.html",
  "https://www.costco.com/fresh-produce.html",
];

const PAGE_WAIT_MS = 8000;

async function main() {
  console.error("[discover] Starting Costco API discovery...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(90_000);

  const discovered = {}; // url → { count, sampleKeys, pagination, sample }

  function tryExtractProducts(data) {
    if (!data || typeof data !== "object") return [];
    const candidates = [];

    function walk(node, depth) {
      if (depth > 8 || !node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child, depth + 1);
        return;
      }
      // Costco product objects typically have itemNumber + displayName/name
      const keys = Object.keys(node);
      const hasItemNumber =
        keys.includes("itemNumber") || keys.includes("item_number");
      const hasDisplayName =
        keys.includes("displayName") ||
        keys.includes("name") ||
        keys.includes("title");
      if (hasItemNumber && hasDisplayName) {
        candidates.push(node);
        return;
      }
      for (const val of Object.values(node)) {
        walk(val, depth + 1);
      }
    }

    walk(data, 0);
    return candidates;
  }

  for (const url of CATEGORIES) {
    console.error(`\n[discover] Visiting: ${url}`);
    const captured = [];

    const onResponse = async (response) => {
      const rUrl = response.url();
      if (response.status() !== 200) return;
      const ct = response.headers()["content-type"] || "";
      if (!ct.includes("application/json") && !ct.includes("text/plain"))
        return;

      let body;
      try {
        body = await response.json();
      } catch (_) {
        return;
      }

      const products = tryExtractProducts(body);
      if (products.length > 0) {
        captured.push({ url: rUrl, count: products.length, body, products });
      }
    };

    page.on("response", onResponse);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(PAGE_WAIT_MS);

      // Try scrolling to trigger lazy-load
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(3000);
    } catch (err) {
      console.error(`[discover] Navigation error: ${err.message}`);
    }
    page.off("response", onResponse);

    for (const cap of captured) {
      const apiUrl = cap.url.replace(/[?&]currentPage=\d+/, "?currentPage=N");
      if (!discovered[apiUrl]) {
        discovered[apiUrl] = {
          count: cap.count,
          sampleKeys: Object.keys(cap.products[0] || {}),
          sample: cap.products[0] || null,
          rawBodyKeys: Object.keys(cap.body || {}),
        };
      }
      console.error(
        `[discover]   Found ${cap.count} products at: ${cap.url.substring(0, 120)}`,
      );
    }

    // Also probe DOM for embedded data
    const domData = await page.evaluate(() => {
      const result = {};
      // Next.js / SSR data
      const nd = document.getElementById("__NEXT_DATA__");
      if (nd) {
        try {
          const d = JSON.parse(nd.textContent);
          const s = JSON.stringify(d);
          const idx = s.indexOf('"itemNumber"');
          if (idx !== -1) result.nextDataSnippet = s.substring(idx, idx + 500);
        } catch (_) {}
      }
      // Look for window.__* globals with product data
      const scripts = Array.from(document.querySelectorAll("script")).map(
        (s) => s.innerText,
      );
      for (const sc of scripts) {
        if (sc.includes("itemNumber") && sc.length < 200000) {
          result.scriptSnippet = sc.substring(0, 300);
          break;
        }
      }
      // Check product tile DOM selectors
      const tile = document.querySelector(
        '[class*="product-list"], [data-testid*="product"], [class*="ProductList"], ' +
          '[class*="product-tile"], [class*="ProductTile"]',
      );
      if (tile) result.tileHtml = tile.outerHTML.substring(0, 500);
      return result;
    });
    if (Object.keys(domData).length > 0) {
      console.error(
        `[discover]   DOM data probe: ${JSON.stringify(domData).substring(0, 300)}`,
      );
    }
  }

  await browser.close();

  const summary = {
    timestamp: new Date().toISOString(),
    categoriesVisited: CATEGORIES.length,
    endpointsDiscovered: Object.keys(discovered).length,
    endpoints: discovered,
  };

  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  console.error(
    `\n[discover] Done. ${Object.keys(discovered).length} API endpoints found.`,
  );
  if (Object.keys(discovered).length === 0) {
    console.error(
      "[discover] WARNING: No product endpoints discovered. Costco may be using " +
        "server-side rendering or Akamai may be blocking. Try running with --headed " +
        "or check the DOM probe output above for embedded data patterns.",
    );
  }
}

main().catch((err) => {
  console.error("[discover] Fatal:", err);
  process.exit(1);
});
