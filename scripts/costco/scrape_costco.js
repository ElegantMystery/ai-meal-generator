/**
 * scrape_costco.js — Costco food & drinks catalog scraper
 *
 * Strategy:
 *  1. Navigate to each food subcategory page (stealth Playwright).
 *  2. Intercept all JSON XHR/fetch responses to find the product-list API.
 *  3. Replay paginated requests in-browser (same cookies/TLS — avoids Akamai).
 *  4. Navigate to individual PDPs for nutrition / ingredients enrichment.
 *  5. Write costco-items.json + costco-metadata.json.
 *
 * Usage:
 *   node scrape_costco.js [--output <path>] [--meta <path>]
 *
 * Defaults:
 *   --output  ./costco-items.json
 *   --meta    ./costco-metadata.json
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
const OUTPUT_PATH = getArg(
  "--output",
  path.join(__dirname, "costco-items.json"),
);
const META_PATH = getArg(
  "--meta",
  path.join(__dirname, "costco-metadata.json"),
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// Food & drinks category pages. Costco online has fewer SKUs than in-store;
// we cast a wide net across all grocery-adjacent categories.
const CATEGORY_URLS = [
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
  "https://www.costco.com/candy.html",
  "https://www.costco.com/coffee.html",
  "https://www.costco.com/baby-toddler-food.html",
  "https://www.costco.com/deli-prepared-foods.html",
  "https://www.costco.com/organic-foods.html",
];

const COSTCO_BASE = "https://www.costco.com";
const PAGE_TIMEOUT = 60_000;
const NAV_TIMEOUT = 90_000;
const CATEGORY_WAIT_MS = 8000; // time to let each category page settle
const ENRICHMENT_CONCURRENCY = 3;
const ENRICHMENT_CHUNK = 50;
const MIN_ITEMS = 200; // safety threshold

// ---------------------------------------------------------------------------
// Product extraction helpers
// ---------------------------------------------------------------------------

/**
 * Walk a parsed JSON object and collect Costco product nodes.
 * Costco product objects typically have itemNumber + (displayName or name).
 */
function extractProducts(data) {
  const products = [];
  const seenIds = new Set();

  function walk(node, depth) {
    if (depth > 10 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const keys = Object.keys(node);
    const hasId = keys.includes("itemNumber") || keys.includes("item_number");
    const hasName =
      keys.includes("displayName") ||
      keys.includes("name") ||
      keys.includes("title");
    if (hasId && hasName) {
      const id = String(node.itemNumber || node.item_number || "");
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        products.push(node);
      }
      return;
    }
    for (const val of Object.values(node)) {
      walk(val, depth + 1);
    }
  }

  walk(data, 0);
  return products;
}

/** Extract Costco item number (SKU) from a product node. */
function extractSku(raw) {
  return String(raw.itemNumber || raw.item_number || raw.sku || "").trim();
}

/** Extract display name from a product node. */
function extractName(raw) {
  return (raw.displayName || raw.name || raw.title || "").trim() || null;
}

/** Extract price — Costco typically has finalPrice or salePrice / regularPrice. */
function extractPrice(raw) {
  const candidates = [
    raw.finalPrice,
    raw.salePrice,
    raw.yourPrice,
    raw.regularPrice,
    raw.price,
  ];
  for (const c of candidates) {
    if (c != null) {
      const n = parseFloat(String(c).replace(/[^0-9.]/g, ""));
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

/** Extract image URL. Costco uses various thumbnail fields. */
function extractImageUrl(raw) {
  const candidates = [
    raw.thumbnailImageUrl,
    raw.thumbnail,
    raw.imageUrl,
    raw.image,
    raw.mediumImageUrl,
  ];
  for (const c of candidates) {
    if (c && typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

/** Extract category breadcrumb. */
function extractCategories(raw) {
  const cats = raw.categoryPath || raw.categories || raw.breadcrumb || [];
  if (Array.isArray(cats)) {
    return (
      cats
        .map((c) => (typeof c === "string" ? c : c.name || c.label || ""))
        .filter(Boolean)
        .join(" > ") || null
    );
  }
  if (typeof cats === "string") return cats || null;
  return null;
}

/** Extract unit size / net weight field. */
function extractUnitSize(raw) {
  return raw.packageSize || raw.netWeight || raw.unitSize || raw.size || null;
}

/** Extract labels/tags (Organic, Kirkland Signature, etc.) */
function extractTags(raw) {
  const tags = [];
  if (raw.brandName) tags.push(raw.brandName);
  for (const field of ["labels", "badges", "tags", "attributes"]) {
    const val = raw[field];
    if (Array.isArray(val)) {
      for (const t of val) {
        const str = typeof t === "string" ? t : t.name || t.label || "";
        if (str.trim()) tags.push(str.trim());
      }
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

/**
 * Given a product-list API URL, derive a paginator function.
 * Costco typically uses currentPage=N or offset=N query params.
 */
function buildPageUrl(baseUrl, page) {
  const url = new URL(baseUrl);
  // Handle currentPage param
  if (url.searchParams.has("currentPage")) {
    url.searchParams.set("currentPage", String(page));
    return url.toString();
  }
  // Handle offset param (pageSize-based)
  if (url.searchParams.has("offset")) {
    const pageSize = parseInt(url.searchParams.get("pageSize") || "96", 10);
    url.searchParams.set("offset", String(page * pageSize));
    return url.toString();
  }
  // Fallback: append page param
  url.searchParams.set("currentPage", String(page));
  return url.toString();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[scrape_costco] Starting. Output: ${OUTPUT_PATH}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  // Global product map keyed by itemNumber (deduplication across categories)
  const productsByItemNumber = new Map();

  // API templates discovered during category browsing
  // Each entry: { url, method, headers, body (if POST) }
  const discoveredApiTemplates = [];

  // ---------------------------------------------------------------------------
  // Phase 1: Browse category pages + intercept product-list API calls
  // ---------------------------------------------------------------------------
  for (const catUrl of CATEGORY_URLS) {
    console.log(`[scrape_costco] Category: ${catUrl}`);
    const capturedForCategory = [];

    const onResponse = async (response) => {
      const rUrl = response.url();
      if (response.status() !== 200) return;
      const ct = response.headers()["content-type"] || "";
      if (!ct.includes("application/json") && !ct.includes("text/plain"))
        return;

      let body;
      try {
        body = await response.text();
      } catch (_) {
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (_) {
        return;
      }

      const products = extractProducts(parsed);
      if (products.length > 0) {
        for (const prod of products) {
          const sku = extractSku(prod);
          if (sku && !productsByItemNumber.has(sku)) {
            productsByItemNumber.set(sku, prod);
          }
        }
        capturedForCategory.push({
          url: rUrl,
          method: response.request().method(),
          headers: response.request().headers(),
          count: products.length,
        });
      }
    };

    page.on("response", onResponse);
    try {
      await page.goto(catUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(CATEGORY_WAIT_MS);
      // Scroll to trigger lazy-loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    } catch (err) {
      console.log(
        `[scrape_costco] Category nav error (${catUrl}): ${err.message}`,
      );
    }
    page.off("response", onResponse);

    console.log(
      `[scrape_costco]   Collected ${productsByItemNumber.size} total items so far`,
    );

    // Save API templates from this category for pagination later
    for (const cap of capturedForCategory) {
      const alreadyKnown = discoveredApiTemplates.some(
        (t) =>
          // normalise away page number so we don't duplicate
          t.url.replace(/currentPage=\d+/, "") ===
          cap.url.replace(/currentPage=\d+/, ""),
      );
      if (!alreadyKnown) {
        discoveredApiTemplates.push(cap);
        console.log(
          `[scrape_costco]   New API template: ${cap.url.substring(0, 120)}`,
        );
      }
    }
  }

  console.log(
    `[scrape_costco] Phase 1 complete: ${productsByItemNumber.size} items, ` +
      `${discoveredApiTemplates.length} API template(s) discovered`,
  );

  // ---------------------------------------------------------------------------
  // Phase 2: Paginate discovered API endpoints via in-browser fetch
  // (browser context carries valid cookies + TLS fingerprint — bypasses Akamai)
  // ---------------------------------------------------------------------------
  if (discoveredApiTemplates.length > 0) {
    for (const template of discoveredApiTemplates) {
      console.log(
        `[scrape_costco] Paginating: ${template.url.substring(0, 100)}`,
      );

      const safeHeaders = {};
      for (const h of ["content-type", "accept", "x-requested-with"]) {
        if (template.headers[h]) safeHeaders[h] = template.headers[h];
      }

      const moreProducts = await page.evaluate(
        async ({ baseUrl, extraHeaders, method }) => {
          const products = [];
          const seenIds = new Set();

          function tryExtract(data) {
            function walk(node, depth) {
              if (depth > 10 || !node || typeof node !== "object") return;
              if (Array.isArray(node)) {
                for (const c of node) walk(c, depth + 1);
                return;
              }
              const keys = Object.keys(node);
              const hasId =
                keys.includes("itemNumber") || keys.includes("item_number");
              const hasName =
                keys.includes("displayName") ||
                keys.includes("name") ||
                keys.includes("title");
              if (hasId && hasName) {
                const id = String(
                  node.itemNumber || node.item_number || "",
                ).trim();
                if (id && !seenIds.has(id)) {
                  seenIds.add(id);
                  products.push(node);
                }
                return;
              }
              for (const val of Object.values(node)) walk(val, depth + 1);
            }
            walk(data, 0);
          }

          function buildPagedUrl(urlStr, pageNum) {
            const u = new URL(urlStr);
            if (u.searchParams.has("currentPage")) {
              u.searchParams.set("currentPage", String(pageNum));
            } else if (u.searchParams.has("offset")) {
              const ps = parseInt(u.searchParams.get("pageSize") || "96", 10);
              u.searchParams.set("offset", String(pageNum * ps));
            } else {
              u.searchParams.set("currentPage", String(pageNum));
            }
            return u.toString();
          }

          let page = 1; // start from page 1 (page 0 already captured)
          let consecutiveEmpty = 0;
          while (page <= 50 && consecutiveEmpty < 2) {
            const pagedUrl = buildPagedUrl(baseUrl, page);
            try {
              const ac = new AbortController();
              const timer = setTimeout(() => ac.abort(), 25_000);
              let resp;
              try {
                resp = await fetch(pagedUrl, {
                  method: method || "GET",
                  headers: {
                    Accept: "application/json",
                    ...extraHeaders,
                  },
                  credentials: "include",
                  signal: ac.signal,
                });
              } finally {
                clearTimeout(timer);
              }
              if (!resp.ok) {
                if (resp.status === 403 || resp.status === 429) break;
                consecutiveEmpty++;
                page++;
                continue;
              }
              const data = await resp.json();
              const before = products.length;
              tryExtract(data);
              const added = products.length - before;
              console.log(`[pagination] page=${page} added=${added}`);
              if (added === 0) {
                consecutiveEmpty++;
              } else {
                consecutiveEmpty = 0;
              }
            } catch (e) {
              console.log(`[pagination] page=${page} error: ${e.message}`);
              consecutiveEmpty++;
            }
            page++;
            await new Promise((r) => setTimeout(r, 200));
          }
          return products;
        },
        {
          baseUrl: template.url,
          extraHeaders: safeHeaders,
          method: template.method,
        },
      );

      console.log(
        `[scrape_costco] Pagination yielded ${moreProducts.length} additional products`,
      );
      for (const prod of moreProducts) {
        const sku = extractSku(prod);
        if (sku && !productsByItemNumber.has(sku)) {
          productsByItemNumber.set(sku, prod);
        }
      }
    }
  } else {
    console.log(
      "[scrape_costco] WARNING: No API templates discovered during category browse. " +
        "Costco may be server-side rendering. Falling back to DOM-based collection.",
    );

    // Fallback: extract product data from embedded JSON in each category page
    for (const catUrl of CATEGORY_URLS) {
      console.log(`[scrape_costco] DOM fallback for: ${catUrl}`);
      try {
        await page.goto(catUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(CATEGORY_WAIT_MS);

        const domProducts = await page.evaluate(() => {
          const products = [];
          // Try embedded JSON blobs in <script> tags
          const scripts = Array.from(
            document.querySelectorAll('script[type="application/ld+json"]'),
          );
          for (const sc of scripts) {
            try {
              const data = JSON.parse(sc.textContent);
              if (data["@type"] === "Product" && data.sku) {
                products.push({
                  itemNumber: data.sku,
                  displayName: data.name,
                  finalPrice: data.offers?.price,
                  thumbnailImageUrl: data.image?.[0] || data.image,
                  description: data.description,
                });
              }
            } catch (_) {}
          }
          // Try __NEXT_DATA__ or similar
          const nd = document.getElementById("__NEXT_DATA__");
          if (nd) {
            try {
              const d = JSON.parse(nd.textContent);
              const raw = JSON.stringify(d);
              // Find all itemNumber occurrences
              const matches = raw.matchAll(/"itemNumber"\s*:\s*"?(\d+)"?/g);
              for (const m of matches) {
                products.push({ itemNumber: m[1], _fromNextData: true });
              }
            } catch (_) {}
          }
          return products;
        });

        for (const prod of domProducts) {
          const sku = extractSku(prod);
          if (sku && !productsByItemNumber.has(sku)) {
            productsByItemNumber.set(sku, prod);
          }
        }
        console.log(
          `[scrape_costco]   DOM collected ${domProducts.length} items`,
        );
      } catch (err) {
        console.log(`[scrape_costco] DOM fallback error: ${err.message}`);
      }
    }
  }

  console.log(
    `[scrape_costco] After Phase 2: ${productsByItemNumber.size} unique items`,
  );

  // ---------------------------------------------------------------------------
  // Phase 3: Enrich products with nutrition + ingredients from PDPs
  //
  // Costco embeds product specs in application/ld+json or a product-detail
  // JSON API (e.g. /AjaxProductDetails?itemNumber=XXXXX).
  // ---------------------------------------------------------------------------
  console.log(
    `[scrape_costco] Phase 3: enriching ${productsByItemNumber.size} products...`,
  );

  // First, navigate to one PDP to discover the detail API pattern
  const allSkus = [...productsByItemNumber.keys()];
  let detailApiPattern = null; // { urlTemplate, method, headers }

  if (allSkus.length > 0) {
    const firstSku = allSkus[0];
    const pdpUrl = `${COSTCO_BASE}/p/${firstSku}.product.${firstSku}.html`;
    console.log(`[scrape_costco] Navigating to first PDP: ${pdpUrl}`);

    const capturedDetailApis = [];
    const onDetailResponse = async (response) => {
      const rUrl = response.url();
      if (response.status() !== 200) return;
      if (
        !rUrl.includes("AjaxProduct") &&
        !rUrl.includes("itemNumber=") &&
        !rUrl.includes("/product/") &&
        !rUrl.includes("pdp")
      )
        return;
      const ct = response.headers()["content-type"] || "";
      if (!ct.includes("application/json")) return;
      try {
        const body = await response.json();
        if (body && typeof body === "object") {
          capturedDetailApis.push({
            url: rUrl,
            method: response.request().method(),
            headers: response.request().headers(),
            sample: body,
          });
        }
      } catch (_) {}
    };

    page.on("response", onDetailResponse);
    try {
      await page.goto(pdpUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
    } catch (err) {
      console.log(`[scrape_costco] PDP nav error: ${err.message}`);
    }
    page.off("response", onDetailResponse);

    if (capturedDetailApis.length > 0) {
      detailApiPattern = capturedDetailApis[0];
      console.log(
        `[scrape_costco] Detail API found: ${detailApiPattern.url.substring(0, 100)}`,
      );
    }

    // Regardless of API, extract nutrition/ingredients from the first PDP DOM
    const firstPdpData = await page.evaluate(() => {
      const result = { nutrition: null, ingredients: null, description: null };

      // application/ld+json often has description
      const ldJsonScripts = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      );
      for (const sc of ldJsonScripts) {
        try {
          const d = JSON.parse(sc.textContent);
          if (d.description) result.description = d.description;
        } catch (_) {}
      }

      // Look for nutrition facts section in DOM
      const bodyText = document.body.innerText || "";
      const nutIdx = bodyText.indexOf("Nutrition Facts");
      if (nutIdx !== -1) {
        result.nutrition = bodyText.substring(nutIdx, nutIdx + 1200);
      }

      // Look for ingredients section
      const ingMatch = bodyText.match(
        /\bIngredients?:?\s*([A-Z][^.]{10,500}\.)/i,
      );
      if (ingMatch) result.ingredients = ingMatch[1];

      return result;
    });
    console.log(
      `[scrape_costco] First PDP DOM probe: nutrition=${!!firstPdpData.nutrition} ` +
        `ingredients=${!!firstPdpData.ingredients}`,
    );

    if (firstPdpData.nutrition || firstPdpData.ingredients) {
      const raw = productsByItemNumber.get(firstSku) || {};
      if (firstPdpData.nutrition) raw.nutrition = firstPdpData.nutrition;
      if (firstPdpData.ingredients) raw.ingredients = firstPdpData.ingredients;
      if (firstPdpData.description && !raw.description)
        raw.description = firstPdpData.description;
      productsByItemNumber.set(firstSku, raw);
    }
  }

  // Enrich remaining products in chunks
  const enrichTargets = allSkus.slice(1); // first already done above
  let totalEnriched = 0;

  page.setDefaultTimeout(0);

  for (let i = 0; i < enrichTargets.length; i += ENRICHMENT_CHUNK) {
    const chunk = enrichTargets.slice(i, i + ENRICHMENT_CHUNK);

    // Build PDP URLs for this chunk
    const pdpItems = chunk.map((sku) => ({
      sku,
      pdpUrl: `${COSTCO_BASE}/p/${sku}.product.${sku}.html`,
      detailApiUrl: (() => {
        if (!detailApiPattern) return null;
        const substituted = detailApiPattern.url.replace(
          /itemNumber=\d+/,
          `itemNumber=${sku}`,
        );
        // Only use if the replacement actually changed the URL; otherwise the
        // SKU is likely in the path (not a query param) and we cannot template it.
        return substituted !== detailApiPattern.url ? substituted : null;
      })(),
    }));

    const safeDetailHeaders = detailApiPattern
      ? (() => {
          const h = {};
          for (const k of ["content-type", "accept", "x-requested-with"]) {
            if (detailApiPattern.headers[k]) h[k] = detailApiPattern.headers[k];
          }
          return h;
        })()
      : {};

    const enrichResults = await page.evaluate(
      async ({ items, detailApiMethod, extraHeaders, concurrency }) => {
        const results = {};

        function extractFromData(data) {
          const r = { nutrition: null, ingredients: null, description: null };
          function walk(node, depth) {
            if (depth > 8 || !node || typeof node !== "object") return;
            if (Array.isArray(node)) {
              for (const c of node) walk(c, depth + 1);
              return;
            }
            if (node.nutrition || node.nutritionFacts || node.nutritionInfo) {
              r.nutrition =
                node.nutrition || node.nutritionFacts || node.nutritionInfo;
            }
            if (node.ingredients || node.ingredientsText) {
              r.ingredients = node.ingredients || node.ingredientsText;
            }
            if (!r.description && node.description) {
              r.description = node.description;
            }
            for (const val of Object.values(node)) walk(val, depth + 1);
          }
          walk(data, 0);
          return r;
        }

        async function enrichOne({ sku, pdpUrl, detailApiUrl }) {
          const entry = (results[sku] = {
            nutrition: null,
            ingredients: null,
          });

          // Try detail API first (faster than full PDP navigation)
          if (detailApiUrl) {
            try {
              const ac = new AbortController();
              const timer = setTimeout(() => ac.abort(), 15_000);
              let resp;
              try {
                resp = await fetch(detailApiUrl, {
                  method: detailApiMethod || "GET",
                  headers: { Accept: "application/json", ...extraHeaders },
                  credentials: "include",
                  signal: ac.signal,
                });
              } finally {
                clearTimeout(timer);
              }
              if (resp.ok) {
                const data = await resp.json();
                const extracted = extractFromData(data);
                if (extracted.nutrition) entry.nutrition = extracted.nutrition;
                if (extracted.ingredients)
                  entry.ingredients = extracted.ingredients;
              }
            } catch (_) {}
          }

          // If detail API yielded nothing, try fetching PDP HTML and parsing
          if (!entry.nutrition && !entry.ingredients) {
            try {
              const ac = new AbortController();
              const timer = setTimeout(() => ac.abort(), 15_000);
              let resp;
              try {
                resp = await fetch(pdpUrl, {
                  credentials: "include",
                  signal: ac.signal,
                });
              } finally {
                clearTimeout(timer);
              }
              if (resp.ok) {
                const html = await resp.text();
                const nutIdx = html.indexOf("Nutrition Facts");
                if (nutIdx !== -1) {
                  // Strip HTML tags from a ~1500 char window
                  const slice = html.substring(nutIdx, nutIdx + 1500);
                  entry.nutrition = slice.replace(/<[^>]+>/g, " ").trim();
                }
                const ingMatch = html.match(
                  /Ingredients?:?\s*([A-Z][^<]{10,500})/,
                );
                if (ingMatch) {
                  entry.ingredients = ingMatch[1]
                    .replace(/<[^>]+>/g, " ")
                    .trim();
                }
              }
            } catch (_) {}
          }
        }

        for (let j = 0; j < items.length; j += concurrency) {
          await Promise.all(
            items.slice(j, j + concurrency).map((item) => enrichOne(item)),
          );
          await new Promise((r) => setTimeout(r, 150));
        }
        return results;
      },
      {
        items: pdpItems,
        detailApiMethod: detailApiPattern?.method || "GET",
        extraHeaders: safeDetailHeaders,
        concurrency: ENRICHMENT_CONCURRENCY,
      },
    );

    for (const sku of chunk) {
      const detail = enrichResults[sku];
      if (detail) {
        const raw = productsByItemNumber.get(sku) || {};
        if (detail.nutrition) {
          raw.nutrition = detail.nutrition;
          totalEnriched++;
        }
        if (detail.ingredients) raw.ingredients = detail.ingredients;
        productsByItemNumber.set(sku, raw);
      }
    }

    console.log(
      `[scrape_costco] Enrichment: ${Math.min(i + ENRICHMENT_CHUNK, enrichTargets.length)}` +
        `/${enrichTargets.length} processed (${totalEnriched} enriched so far)`,
    );
  }

  page.setDefaultTimeout(PAGE_TIMEOUT);
  console.log(
    `[scrape_costco] Enrichment complete: ${totalEnriched}/${productsByItemNumber.size} have nutrition`,
  );

  await browser.close();

  // ---------------------------------------------------------------------------
  // Build output array (same shape as tj-items.json)
  // ---------------------------------------------------------------------------
  const items = [];
  for (const [sku, raw] of productsByItemNumber) {
    const name = extractName(raw);
    if (!sku || !name) continue; // skip incomplete records

    items.push({
      store: "COSTCO",
      sku,
      name,
      price: extractPrice(raw),
      weight: extractUnitSize(raw) || null,
      categories: extractCategories(raw),
      nutrition: raw.nutrition || null,
      ingredients: raw.ingredients || null,
      tags: extractTags(raw),
      raw,
    });
  }

  // Sanity check
  if (items.length < MIN_ITEMS) {
    console.error(
      `[scrape_costco] ERROR: Only ${items.length} items collected — ` +
        `expected at least ${MIN_ITEMS}. ` +
        "Costco API may have changed or Akamai is blocking. " +
        "Run discover_categories.js to diagnose.",
    );
    process.exit(1);
  }

  // Write items
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2), "utf8");
  console.log(`[scrape_costco] Wrote ${items.length} items to ${OUTPUT_PATH}`);

  // Write metadata
  const meta = {
    totalProducts: items.length,
    withNutrition: items.filter((i) => i.nutrition).length,
    withIngredients: items.filter((i) => i.ingredients).length,
    categoriesScraped: CATEGORY_URLS.length,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  console.log(`[scrape_costco] Metadata written to ${META_PATH}`);
  console.log("[scrape_costco] Done.");
}

main().catch((err) => {
  console.error("[scrape_costco] Fatal error:", err);
  process.exit(1);
});
