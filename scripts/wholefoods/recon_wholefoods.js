"use strict";

/**
 * recon_wholefoods.js — Whole Foods Market API reconnaissance
 *
 * Intercepts ALL XHR/fetch responses while browsing category pages to identify:
 *   - API endpoints that return product listings
 *   - Auth/cookie requirements
 *   - Pagination mechanism
 *   - Whether nutrition/ingredients are in listing or detail responses
 *   - Bot detection behavior
 *
 * Usage:
 *   node recon_wholefoods.js
 *
 * Output:
 *   recon-output.json  — all intercepted API responses
 *   recon-summary.txt  — human-readable summary of findings
 */

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");

chromium.use(StealthPlugin());

const WF_BASE = "https://www.wholefoodsmarket.com";
const WAIT_MS = 10_000;   // wait for anti-bot challenge + initial load
const SCROLL_MS = 3_000;  // pause between scrolls

// Category pages to probe
const PROBE_CATEGORIES = [
  "/products/produce",
  "/products/meat-seafood",
  "/products/dairy-eggs",
  "/products/snacks-chips-salsas",
  "/products/beverages",
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const allResponses = [];
  const productApiCandidates = [];
  let nextDataFound = null;

  console.log("[recon] Launching browser (headless)...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(90_000);

  // ---------------------------------------------------------------------------
  // Intercept all responses
  // ---------------------------------------------------------------------------
  page.on("response", async (response) => {
    const url = response.url();
    const status = response.status();
    const ct = response.headers()["content-type"] || "";

    // Skip static assets
    if (url.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ico)(\?|$)/i)) return;
    if (url.includes("analytics") || url.includes("tracking") || url.includes("segment")) return;

    const entry = {
      url,
      status,
      contentType: ct,
      bodySnippet: null,
      bodySize: 0,
      hasProducts: false,
      productCount: null,
    };

    if (ct.includes("application/json") || ct.includes("text/javascript")) {
      try {
        const text = await response.text().catch(() => "");
        entry.bodySize = text.length;
        entry.bodySnippet = text.substring(0, 800);

        // Check if this looks like a product listing response
        const lower = text.toLowerCase();
        if (
          lower.includes('"products"') ||
          lower.includes('"items"') ||
          lower.includes('"entries"') ||
          lower.includes('"results"') ||
          lower.includes('"totalCount"') ||
          lower.includes('"pageInfo"') ||
          lower.includes('"catalog"')
        ) {
          entry.hasProducts = true;
          try {
            const json = JSON.parse(text);
            // Try to count products in common shapes
            const items =
              json?.data?.products?.items ||
              json?.data?.catalog?.items ||
              json?.items ||
              json?.results ||
              json?.products ||
              json?.entries ||
              (Array.isArray(json) ? json : null);
            if (items) entry.productCount = items.length;
          } catch (_) {}
          productApiCandidates.push({ url, status, bodySnippet: text.substring(0, 1200) });
          console.log(`[recon] *** PRODUCT CANDIDATE: ${url.substring(0, 100)} (${status})`);
        }
        allResponses.push(entry);
      } catch (_) {}
    } else if (ct.includes("text/html")) {
      // Only log HTML for the main navigations
      if (status === 200 && url.includes("wholefoodsmarket.com")) {
        entry.bodySize = -1; // don't store HTML body
        allResponses.push(entry);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Phase 1: Homepage — check basic access and bot detection
  // ---------------------------------------------------------------------------
  console.log(`[recon] Navigating to homepage...`);
  try {
    await page.goto(WF_BASE, { waitUntil: "domcontentloaded" });
    await sleep(WAIT_MS);

    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      blocked:
        document.title.toLowerCase().includes("access denied") ||
        document.body.innerText.toLowerCase().includes("access denied") ||
        document.body.innerText.toLowerCase().includes("robot"),
      snippet: document.body.innerText.substring(0, 300).replace(/\s+/g, " "),
      hasNextData: !!document.getElementById("__NEXT_DATA__"),
      nextDataSnippet: document.getElementById("__NEXT_DATA__")
        ? document.getElementById("__NEXT_DATA__").textContent.substring(0, 500)
        : null,
    }));

    console.log(`[recon] Title: "${pageInfo.title}"`);
    console.log(`[recon] Blocked: ${pageInfo.blocked}`);
    console.log(`[recon] Has __NEXT_DATA__: ${pageInfo.hasNextData}`);
    console.log(`[recon] Snippet: ${pageInfo.snippet.substring(0, 150)}`);

    if (pageInfo.nextDataSnippet) {
      nextDataFound = pageInfo.nextDataSnippet;
      console.log(`[recon] __NEXT_DATA__ snippet: ${pageInfo.nextDataSnippet.substring(0, 200)}`);
    }

    if (pageInfo.blocked) {
      console.log("[recon] WARNING: Homepage blocked. Bot detection active.");
    }
  } catch (err) {
    console.log(`[recon] Homepage nav error: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Probe category pages
  // ---------------------------------------------------------------------------
  for (const catPath of PROBE_CATEGORIES) {
    console.log(`\n[recon] --- Category: ${catPath} ---`);
    try {
      await page.goto(`${WF_BASE}${catPath}`, { waitUntil: "domcontentloaded" });
      await sleep(WAIT_MS);

      const info = await page.evaluate(() => ({
        title: document.title,
        url: window.location.href,
        blocked:
          document.title.toLowerCase().includes("access denied") ||
          document.body.innerText.toLowerCase().includes("access denied"),
        snippet: document.body.innerText.substring(0, 400).replace(/\s+/g, " "),
        hasNextData: !!document.getElementById("__NEXT_DATA__"),
        nextDataSnippet: document.getElementById("__NEXT_DATA__")
          ? document.getElementById("__NEXT_DATA__").textContent.substring(0, 1000)
          : null,
        productCount: document.querySelectorAll('[data-testid*="product"], [class*="product-card"], [class*="ProductCard"]').length,
      }));

      console.log(`[recon]   Title: "${info.title}"`);
      console.log(`[recon]   Final URL: ${info.url}`);
      console.log(`[recon]   Blocked: ${info.blocked}`);
      console.log(`[recon]   DOM product cards found: ${info.productCount}`);
      console.log(`[recon]   Snippet: ${info.snippet.substring(0, 200)}`);

      if (info.hasNextData && !nextDataFound) {
        nextDataFound = info.nextDataSnippet;
        console.log(`[recon]   __NEXT_DATA__: ${info.nextDataSnippet?.substring(0, 300)}`);
      }

      // Scroll to trigger lazy loading / pagination
      console.log(`[recon]   Scrolling to trigger lazy-load...`);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await sleep(SCROLL_MS);
      }

      // Check for load-more button
      const loadMoreText = await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button")].filter(
          (b) => b.innerText.toLowerCase().includes("load") || b.innerText.toLowerCase().includes("more")
        );
        return btns.map((b) => b.innerText.trim()).join(" | ");
      });
      if (loadMoreText) console.log(`[recon]   Load-more buttons: "${loadMoreText}"`);

      // Check for pagination links
      const paginationInfo = await page.evaluate(() => {
        const links = [...document.querySelectorAll("a[href*='page='], a[href*='/page/'], [aria-label*='page'], [class*='pagination']")];
        return links.slice(0, 5).map((l) => l.href || l.getAttribute("aria-label") || l.className).join(" | ");
      });
      if (paginationInfo) console.log(`[recon]   Pagination elements: ${paginationInfo.substring(0, 200)}`);

    } catch (err) {
      console.log(`[recon]   Nav error: ${err.message}`);
    }

    await sleep(2000); // be polite between categories
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Try product detail page
  // ---------------------------------------------------------------------------
  console.log(`\n[recon] --- Product detail page probe ---`);
  try {
    // Try a known product URL pattern
    await page.goto(`${WF_BASE}/products/bananas`, { waitUntil: "domcontentloaded" });
    await sleep(WAIT_MS);

    const detailInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      blocked: document.title.toLowerCase().includes("access denied"),
      hasNutrition: document.body.innerText.toLowerCase().includes("nutrition facts"),
      hasIngredients: document.body.innerText.toLowerCase().includes("ingredient"),
      snippet: document.body.innerText.substring(0, 500).replace(/\s+/g, " "),
    }));

    console.log(`[recon]   Detail title: "${detailInfo.title}"`);
    console.log(`[recon]   Final URL: ${detailInfo.url}`);
    console.log(`[recon]   Has nutrition: ${detailInfo.hasNutrition}`);
    console.log(`[recon]   Has ingredients: ${detailInfo.hasIngredients}`);
    console.log(`[recon]   Snippet: ${detailInfo.snippet.substring(0, 200)}`);
  } catch (err) {
    console.log(`[recon]   Detail nav error: ${err.message}`);
  }

  await browser.close();

  // ---------------------------------------------------------------------------
  // Write outputs
  // ---------------------------------------------------------------------------
  const output = {
    timestamp: new Date().toISOString(),
    totalResponsesIntercepted: allResponses.length,
    productApiCandidates: productApiCandidates.length,
    nextDataFound: !!nextDataFound,
    nextDataSnippet: nextDataFound,
    allResponses: allResponses.slice(0, 200), // cap at 200
    productCandidates: productApiCandidates,
  };

  const outPath = path.join(__dirname, "recon-output.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n[recon] Wrote ${outPath}`);

  // Human-readable summary
  const summary = [
    `=== Whole Foods Recon Summary ===`,
    `Timestamp: ${output.timestamp}`,
    `Total API responses intercepted: ${output.totalResponsesIntercepted}`,
    `Product API candidates: ${output.productApiCandidates}`,
    `__NEXT_DATA__ found: ${output.nextDataFound}`,
    ``,
    `=== Product API Candidates ===`,
    ...productApiCandidates.map(
      (c) => `  URL: ${c.url}\n  Status: ${c.status}\n  Snippet: ${c.bodySnippet.substring(0, 400)}\n`
    ),
    ``,
    `=== All Intercepted API URLs ===`,
    ...allResponses
      .filter((r) => r.contentType.includes("json"))
      .map((r) => `  [${r.status}] ${r.url.substring(0, 120)} (${r.bodySize} bytes)`),
  ].join("\n");

  const summaryPath = path.join(__dirname, "recon-summary.txt");
  fs.writeFileSync(summaryPath, summary, "utf8");
  console.log(`[recon] Wrote ${summaryPath}`);
  console.log(`\n=== Quick Summary ===`);
  console.log(`Product API candidates: ${productApiCandidates.length}`);
  console.log(`All JSON responses: ${allResponses.filter((r) => r.contentType.includes("json")).length}`);
  console.log(`__NEXT_DATA__ present: ${!!nextDataFound}`);
}

main().catch((err) => {
  console.error("[recon] Fatal:", err);
  process.exit(1);
});
