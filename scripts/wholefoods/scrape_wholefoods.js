/**
 * scrape_wholefoods.js — Whole Foods Market product catalog scraper
 *
 * Strategy:
 *  1. Navigate to WholeFoodsMarket.com to establish a browser session.
 *  2. Phase 1: Call /api/products/category/{category} in-browser for each food
 *     category, paginate via offset, collect all products with category labels.
 *  3. Phase 2: Batch-fetch each /product/{slug} page in-browser, parse
 *     nutrition facts + ingredients from the server-rendered HTML.
 *  4. Write wholefoods-items.json + wholefoods-metadata.json.
 *
 * HTML structure confirmed via recon:
 *   Ingredients: <h4>Ingredients</h4><p class="...">TEXT</p>
 *   Nutrition:   <section class="w-pie--nutrition-facts">...</section>
 *
 * Usage:
 *   node scrape_wholefoods.js [--output <path>] [--meta <path>]
 */

"use strict";

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs   = require("fs");
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
const OUTPUT_PATH = getArg("--output", path.join(__dirname, "wholefoods-items.json"));
const META_PATH   = getArg("--meta",   path.join(__dirname, "wholefoods-metadata.json"));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WF_BASE          = "https://www.wholefoodsmarket.com";
const STORE_ID         = 10259;   // San Jose CA — high-inventory store
const API_LIMIT        = 60;      // items per page (API max)
const PAGE_TIMEOUT     = 90_000;
const NAV_TIMEOUT      = 90_000;
const SESSION_WAIT     = 8_000;
const ENRICH_CONCURRENCY = 5;
const ENRICH_CHUNK     = 50;
const ENRICH_DELAY     = 200;     // ms between concurrent batches
const MIN_ITEMS        = 500;

// Food categories to scrape with human-readable labels
const FOOD_CATEGORIES = [
  { slug: "produce",                label: "Produce" },
  { slug: "dairy-eggs",             label: "Dairy & Eggs" },
  { slug: "meat",                   label: "Meat" },
  { slug: "seafood",                label: "Seafood" },
  { slug: "prepared-foods",         label: "Prepared Foods" },
  { slug: "pantry-essentials",      label: "Pantry Essentials" },
  { slug: "breads-rolls-bakery",    label: "Breads, Rolls & Bakery" },
  { slug: "desserts",               label: "Desserts" },
  { slug: "frozen-foods",           label: "Frozen Foods" },
  { slug: "snacks-chips-salsas-dips","label": "Snacks, Chips & Salsas" },
  { slug: "beverages",              label: "Beverages" },
  { slug: "wine-beer-spirits",      label: "Wine, Beer & Spirits" },
  { slug: "baby-child",             label: "Baby & Child" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[scrape_wf] Starting. Output: ${OUTPUT_PATH}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  // -------------------------------------------------------------------------
  // Establish session
  // -------------------------------------------------------------------------
  console.log("[scrape_wf] Establishing session...");
  await page.goto(`${WF_BASE}/products`, { waitUntil: "domcontentloaded" });
  await sleep(SESSION_WAIT);

  const sessionOk = await page.evaluate(() =>
    !document.body.innerText.includes("Access Denied")
  );
  if (!sessionOk) {
    console.error("[scrape_wf] ERROR: Blocked on session establishment.");
    await browser.close();
    process.exit(1);
  }
  console.log("[scrape_wf] Session established.");

  // -------------------------------------------------------------------------
  // Phase 1: Collect products per food category
  // -------------------------------------------------------------------------
  console.log("[scrape_wf] Phase 1: Fetching products by category...");
  const productMap = new Map(); // slug → enriched product object

  for (const { slug: catSlug, label: catLabel } of FOOD_CATEGORIES) {
    console.log(`[scrape_wf]   Category: ${catLabel} (${catSlug})`);

    // Get total for this category
    const catTotal = await page.evaluate(
      async ({ storeId, catSlug }) => {
        try {
          const r = await fetch(
            `/api/products/category/${catSlug}?store=${storeId}&limit=1&offset=0`,
            { credentials: "include", headers: { accept: "application/json" } },
          );
          const d = await r.json();
          return d?.meta?.total?.value || 0;
        } catch (_) { return 0; }
      },
      { storeId: STORE_ID, catSlug },
    );

    if (catTotal === 0) {
      console.log(`[scrape_wf]     Empty or unavailable, skipping.`);
      continue;
    }

    const catPages = Math.ceil(catTotal / API_LIMIT);
    console.log(`[scrape_wf]     Total: ${catTotal} products, ${catPages} pages`);

    // Paginate 5 pages concurrently
    const FETCH_CONCURRENCY = 5;
    let newInCat = 0;
    for (let pageIdx = 0; pageIdx < catPages; pageIdx += FETCH_CONCURRENCY) {
      const offsets = [];
      for (let j = pageIdx; j < Math.min(pageIdx + FETCH_CONCURRENCY, catPages); j++) {
        offsets.push(j * API_LIMIT);
      }

      const batchResults = await page.evaluate(
        async ({ storeId, catSlug, apiLimit, offsets }) => {
          const results = [];
          await Promise.all(
            offsets.map(async (offset) => {
              try {
                const url =
                  `/api/products/category/${catSlug}?store=${storeId}&limit=${apiLimit}&offset=${offset}`;
                const r = await fetch(url, {
                  credentials: "include",
                  headers: { accept: "application/json" },
                });
                const d = await r.json();
                results.push({ offset, products: d.results || [] });
              } catch (e) {
                results.push({ offset, products: [], error: e.message });
              }
            }),
          );
          return results;
        },
        { storeId: STORE_ID, catSlug, apiLimit: API_LIMIT, offsets },
      );

      for (const { products } of batchResults) {
        for (const p of products) {
          if (!p.slug) continue;
          if (!productMap.has(p.slug)) {
            productMap.set(p.slug, { ...p, _category: catLabel });
            newInCat++;
          }
        }
      }
      await sleep(150);
    }
    console.log(`[scrape_wf]     +${newInCat} new (total: ${productMap.size})`);
    await sleep(500); // polite pause between categories
  }

  console.log(`[scrape_wf] Phase 1 complete: ${productMap.size} unique products`);

  // -------------------------------------------------------------------------
  // Phase 2: Enrich with nutrition + ingredients (HTML scrape per product)
  // -------------------------------------------------------------------------
  const allSlugs = [...productMap.keys()];
  console.log(`[scrape_wf] Phase 2: Enriching ${allSlugs.length} products...`);

  let totalEnriched = 0;
  page.setDefaultTimeout(0);

  for (let i = 0; i < allSlugs.length; i += ENRICH_CHUNK) {
    const chunk = allSlugs.slice(i, i + ENRICH_CHUNK);

    const enrichResults = await page.evaluate(
      async ({ slugs, baseUrl, concurrency, delay }) => {
        const results = {};

        async function enrichOne(slug) {
          const entry = { nutrition: null, ingredients: null, description: null, dietaryTags: [] };
          try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 20_000);
            let resp;
            try {
              resp = await fetch(`${baseUrl}/product/${slug}`, { credentials: "include", signal: ac.signal });
            } finally {
              clearTimeout(timer);
            }
            if (!resp.ok) return entry;
            const html = await resp.text();

            // --- Ingredients ---
            // HTML structure: <h4>Ingredients</h4><p class="...">&#x27;TEXT&#x27;</p>
            const ingMatch = html.match(/Ingredients<\/h4>\s*<p[^>]*>([\s\S]{5,1200}?)<\/p>/i);
            if (ingMatch) {
              entry.ingredients = ingMatch[1]
                .replace(/&#x27;/gi, "'")
                .replace(/&amp;/gi, "&")
                .replace(/&lt;/gi, "<")
                .replace(/&gt;/gi, ">")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim();
            }

            // --- Nutrition Facts ---
            // HTML structure: <section class="w-pie--nutrition-facts">...</section>
            const nutMatch = html.match(/<section[^>]*w-pie--nutrition-facts[^>]*>([\s\S]{20,4000}?)<\/section>/i);
            if (nutMatch) {
              entry.nutrition = nutMatch[1]
                .replace(/<[^>]+>/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim();
            }

            // --- Dietary tags (Vegan, Vegetarian, Gluten-Free, etc.) ---
            const dietMatches = html.matchAll(/aria-label="([^"]{3,40})"\s*data-testid="diet-badge/gi);
            for (const m of dietMatches) {
              entry.dietaryTags.push(m[1].trim());
            }

            // --- Meta description ---
            const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]{10,300})"/i);
            if (descMatch) entry.description = descMatch[1].trim();
          } catch (_) {}
          return entry;
        }

        for (let j = 0; j < slugs.length; j += concurrency) {
          const batch = slugs.slice(j, j + concurrency);
          const batchResults = await Promise.all(batch.map(enrichOne));
          batch.forEach((slug, k) => { results[slug] = batchResults[k]; });
          await new Promise((r) => setTimeout(r, delay));
        }
        return results;
      },
      { slugs: chunk, baseUrl: WF_BASE, concurrency: ENRICH_CONCURRENCY, delay: ENRICH_DELAY },
    );

    for (const slug of chunk) {
      const enriched = enrichResults[slug];
      if (!enriched) continue;
      const product = productMap.get(slug);
      if (!product) continue;
      if (enriched.nutrition)              { product.nutrition = enriched.nutrition; totalEnriched++; }
      if (enriched.ingredients)            product.ingredients = enriched.ingredients;
      if (enriched.description)            product.description = enriched.description;
      if (enriched.dietaryTags?.length)    product.dietaryTags = enriched.dietaryTags;
      productMap.set(slug, product);
    }

    const progress = Math.min(i + ENRICH_CHUNK, allSlugs.length);
    if (progress % 500 === 0 || progress === allSlugs.length) {
      console.log(`[scrape_wf] Enrichment: ${progress}/${allSlugs.length} (${totalEnriched} with nutrition)`);
    }
  }

  page.setDefaultTimeout(PAGE_TIMEOUT);
  await browser.close();

  // -------------------------------------------------------------------------
  // Build output
  // -------------------------------------------------------------------------
  const items = [];
  for (const [slug, raw] of productMap) {
    const name = (raw.name || "").trim();
    if (!slug || !name) continue;

    items.push({
      store: "WHOLE_FOODS",
      sku: slug,
      name,
      price: typeof raw.regularPrice === "number" ? raw.regularPrice : null,
      weight: null,
      categories: raw._category || null,
      description: raw.description || null,
      nutrition: raw.nutrition || null,
      ingredients: raw.ingredients || null,
      tags: [raw.brand, ...(raw.dietaryTags || [])].filter(Boolean),
      image_url: raw.imageThumbnail || null,
      raw: {
        brand: raw.brand,
        isLocal: raw.isLocal,
        store: raw.store,
        imageThumbnail: raw.imageThumbnail,
      },
    });
  }

  if (items.length < MIN_ITEMS) {
    console.error(
      `[scrape_wf] ERROR: Only ${items.length} items — expected ${MIN_ITEMS}+.`,
    );
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2), "utf8");
  console.log(`[scrape_wf] Wrote ${items.length} items → ${OUTPUT_PATH}`);

  const meta = {
    totalProducts: items.length,
    withNutrition: items.filter((i) => i.nutrition).length,
    withIngredients: items.filter((i) => i.ingredients).length,
    categoriesScraped: FOOD_CATEGORIES.length,
    storeId: STORE_ID,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  console.log(`[scrape_wf] Meta: ${JSON.stringify(meta)}`);
  console.log("[scrape_wf] Done.");
}

main().catch((err) => {
  console.error("[scrape_wf] Fatal:", err);
  process.exit(1);
});
