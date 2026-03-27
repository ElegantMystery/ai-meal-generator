/**
 * scrape_costco.js — Costco food & drinks catalog scraper
 *
 * Strategy:
 *  1. Navigate to the main grocery page to acquire a valid browser session
 *     (cookies + Akamai token).
 *  2. Capture the exact search.costco.com API URL template from the first
 *     intercepted response (or fall back to a known hardcoded pattern).
 *  3. Replay paginated requests in-browser for each category — same cookies/TLS
 *     so Akamai does not block.
 *  4. Navigate to PDPs to extract nutrition / ingredients.
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
const COSTCO_BASE = "https://www.costco.com";
const SEARCH_API_BASE =
  "https://search.costco.com/api/apps/www_costco_com/query/www_costco_com_navigation";
const PAGE_TIMEOUT = 60_000;
const NAV_TIMEOUT = 90_000;
const MIN_ITEMS = 200;
const PAGE_SIZE = 24; // Costco search API default page size

// Costco uses Akamai WAF which blocks rapid requests.
// These delays keep the request rate low enough to avoid triggering rate limits.
const SESSION_WARM_UP_MS = 15_000; // time on first page before any API calls
const INTER_CATEGORY_DELAY_MS = 8_000; // delay between category fetches
const INTER_PAGE_DELAY_MS = 1_500; // delay between paginated pages within a category

// Food & drinks categories — each becomes a separate `url` param in the search API
const FOOD_CATEGORIES = [
  "/grocery-household.html",
  "/snacks.html",
  "/beverages-water.html",
  "/pantry-canned-goods.html",
  "/frozen-foods.html",
  "/dairy-eggs.html",
  "/breakfast-cereals-spreads.html",
  "/bakery-desserts.html",
  "/meat-seafood.html",
  "/fresh-produce.html",
  "/candy.html",
  "/coffee.html",
  "/baby-toddler-food.html",
  "/deli-prepared-foods.html",
  "/organic-foods.html",
];

// ---------------------------------------------------------------------------
// Costco field extractors (actual API field names from discover_categories.js)
// ---------------------------------------------------------------------------

function extractSku(raw) {
  return String(
    raw.item_number ||
      raw.item_location_itemNumber ||
      raw.itemNumber ||
      raw.id ||
      "",
  ).trim();
}

function extractName(raw) {
  return (
    (
      raw.item_product_name ||
      raw.name ||
      raw.item_name ||
      raw.displayName ||
      ""
    ).trim() || null
  );
}

function extractPrice(raw) {
  const candidates = [
    raw.item_location_pricing_salePrice,
    raw.item_location_pricing_listPrice,
    raw.item_location_pricing_pricePerUnit_price,
    raw.finalPrice,
    raw.salePrice,
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

function extractImageUrl(raw) {
  const candidates = [
    raw.item_product_primary_image,
    raw.item_collateral_primaryimage,
    raw.image,
    raw.thumbnailImageUrl,
  ];
  for (const c of candidates) {
    if (c && typeof c === "string") {
      // Costco images may be relative paths
      if (c.startsWith("http")) return c;
      if (c.startsWith("/")) return `https://www.costco.com${c}`;
    }
  }
  return null;
}

function extractCategories(raw, categorySlug) {
  // Use the categoryPath_ss field if present
  const cats = raw.categoryPath_ss || raw.categoryPath || raw.categories || [];
  if (Array.isArray(cats) && cats.length > 0) {
    return (
      cats
        .map((c) => (typeof c === "string" ? c : c.name || c.label || ""))
        .filter(Boolean)
        .join(" > ") || null
    );
  }
  if (typeof cats === "string" && cats) return cats;
  // Fall back to the category slug we scraped from
  if (categorySlug) {
    return categorySlug
      .replace(/^\//, "")
      .replace(/\.html$/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

function extractUnitSize(raw) {
  return (
    raw.Quantity_attr ||
    raw.packageSize ||
    raw.netWeight ||
    raw.unitSize ||
    raw.size ||
    null
  );
}

function extractTags(raw) {
  const tags = [];
  const brand = raw.Brand_attr || raw.brandName || raw.brand;
  if (brand && typeof brand === "string" && brand.trim())
    tags.push(brand.trim());
  const memberOnly = raw.item_member_only;
  if (memberOnly && memberOnly !== "false" && memberOnly !== false)
    tags.push("Member Only");
  const features = raw.item_product_marketing_features;
  if (Array.isArray(features)) {
    for (const f of features) {
      if (typeof f === "string" && f.trim()) tags.push(f.trim());
    }
  }
  return tags;
}

function extractDescription(raw) {
  return (
    raw.item_product_short_description ||
    raw.item_short_description ||
    raw.description ||
    raw.item_product_marketing_statement ||
    null
  );
}

// ---------------------------------------------------------------------------
// Build paginated search API URL
// ---------------------------------------------------------------------------
function buildSearchUrl(templateUrl, categorySlug, start) {
  let base;
  try {
    base = new URL(templateUrl);
  } catch (_) {
    // Fallback: use the known API base with sensible defaults
    base = new URL(SEARCH_API_BASE);
    base.searchParams.set("expoption", "def");
    base.searchParams.set("q", "*:*");
    base.searchParams.set("locale", "en-US");
    base.searchParams.set("expand", "false");
    base.searchParams.set("userLocation", "*");
    base.searchParams.set("loc", "*");
    base.searchParams.set("rows", String(PAGE_SIZE));
    base.searchParams.set(
      "fq",
      '{!tag=item_program_eligibility}item_program_eligibility:("ShipIt")',
    );
    base.searchParams.set("chdcategory", "true");
    base.searchParams.set("chdheader", "true");
  }
  base.searchParams.set("url", categorySlug);
  base.searchParams.set("start", String(start));
  return base.toString();
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

  // ---------------------------------------------------------------------------
  // Phase 1: Navigate to the grocery page to acquire session + capture API URL
  // ---------------------------------------------------------------------------
  console.log(`[scrape_costco] Phase 1: Acquiring session...`);

  let capturedApiTemplate = null; // full URL of the first search API response

  const onSessionResponse = async (response) => {
    const url = response.url();
    if (!url.includes("search.costco.com") || response.status() !== 200) return;
    const ct = response.headers()["content-type"] || "";
    if (!ct.includes("application/json")) return;
    if (!capturedApiTemplate) {
      capturedApiTemplate = url;
      console.log(
        `[scrape_costco] API template captured: ${url.substring(0, 100)}`,
      );
    }
  };

  page.on("response", onSessionResponse);
  try {
    await page.goto(`${COSTCO_BASE}/grocery-household.html`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(SESSION_WARM_UP_MS); // let Akamai challenge resolve + API fire
  } catch (err) {
    console.log(`[scrape_costco] Session nav error: ${err.message}`);
  }
  page.off("response", onSessionResponse);

  if (capturedApiTemplate) {
    console.log("[scrape_costco] Session acquired with API template.");
  } else {
    console.log(
      "[scrape_costco] No API template captured — will use hardcoded pattern.",
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Paginate all food categories via in-browser fetch
  // (browser context carries valid cookies + Akamai token)
  // ---------------------------------------------------------------------------
  console.log("[scrape_costco] Phase 2: Paginating all food categories...");

  const productsByItemNumber = new Map();

  for (const categorySlug of FOOD_CATEGORIES) {
    console.log(`[scrape_costco] Category: ${categorySlug}`);

    const categoryProducts = await page.evaluate(
      async ({ templateUrl, slug, pageSize, searchApiBase }) => {
        const products = [];
        const seenIds = new Set();

        function buildUrl(tmpl, category, start) {
          let base;
          try {
            base = new URL(tmpl || searchApiBase);
          } catch (_) {
            base = new URL(searchApiBase);
            base.searchParams.set("expoption", "def");
            base.searchParams.set("q", "*:*");
            base.searchParams.set("locale", "en-US");
            base.searchParams.set("expand", "false");
            base.searchParams.set("userLocation", "*");
            base.searchParams.set("loc", "*");
            base.searchParams.set("rows", String(pageSize));
            base.searchParams.set(
              "fq",
              '{!tag=item_program_eligibility}item_program_eligibility:("ShipIt")',
            );
            base.searchParams.set("chdcategory", "true");
            base.searchParams.set("chdheader", "true");
          }
          base.searchParams.set("url", category);
          base.searchParams.set("start", String(start));
          return base.toString();
        }

        function extractProducts(data) {
          // Costco search API wraps results in a "response.docs" array
          const docs =
            data?.response?.docs ||
            data?.docs ||
            data?.products ||
            data?.items ||
            [];
          if (Array.isArray(docs)) {
            for (const doc of docs) {
              if (!doc || typeof doc !== "object") continue;
              const id = String(
                doc.item_number ||
                  doc.item_location_itemNumber ||
                  doc.itemNumber ||
                  doc.id ||
                  "",
              ).trim();
              if (id && !seenIds.has(id)) {
                seenIds.add(id);
                products.push(doc);
              }
            }
          }
        }

        // Get total count from first response
        let totalFound = null;
        let start = 0;
        let consecutiveEmpty = 0;

        while (consecutiveEmpty < 2) {
          const url = buildUrl(templateUrl, slug, start);
          try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 20_000);
            let resp;
            try {
              resp = await fetch(url, {
                credentials: "include",
                headers: { Accept: "application/json" },
                signal: ac.signal,
              });
            } finally {
              clearTimeout(timer);
            }

            if (!resp.ok) {
              if (resp.status === 403 || resp.status === 429) break;
              consecutiveEmpty++;
              start += pageSize;
              continue;
            }

            const data = await resp.json();

            // Capture total on first page
            if (totalFound === null) {
              totalFound =
                data?.response?.numFound ||
                data?.numFound ||
                data?.total ||
                null;
            }

            const before = products.length;
            extractProducts(data);
            const added = products.length - before;

            console.log(
              `[category ${slug}] start=${start} added=${added} total=${totalFound}`,
            );

            if (added === 0) {
              consecutiveEmpty++;
            } else {
              consecutiveEmpty = 0;
            }
            start += pageSize;

            // Stop if we've fetched all available items
            if (totalFound !== null && start >= totalFound) break;
            // Safety ceiling
            if (start > 2000) break;

            await new Promise((r) => setTimeout(r, INTER_PAGE_DELAY_MS));
          } catch (e) {
            console.log(
              `[category ${slug}] error at start=${start}: ${e.message}`,
            );
            consecutiveEmpty++;
            start += pageSize;
          }
        }

        return { products, totalFound };
      },
      {
        templateUrl: capturedApiTemplate,
        slug: categorySlug,
        pageSize: PAGE_SIZE,
        searchApiBase: SEARCH_API_BASE,
      },
    );

    let newItems = 0;
    for (const prod of categoryProducts.products) {
      const sku = extractSku(prod);
      if (sku && !productsByItemNumber.has(sku)) {
        // Tag the product with its source category for category_path fallback
        prod._categorySlug = categorySlug;
        productsByItemNumber.set(sku, prod);
        newItems++;
      }
    }
    console.log(
      `[scrape_costco] ${categorySlug}: ${newItems} new items ` +
        `(total: ${productsByItemNumber.size}, api_total: ${categoryProducts.totalFound})`,
    );
    // Respectful delay between categories to avoid triggering Akamai rate limits
    await page.waitForTimeout(INTER_CATEGORY_DELAY_MS);
  }

  console.log(
    `[scrape_costco] Phase 2 complete: ${productsByItemNumber.size} unique items`,
  );

  // ---------------------------------------------------------------------------
  // Phase 3: Enrich with nutrition + ingredients from PDPs
  //
  // Costco PDP HTML contains a "Nutrition Facts" block and "Ingredients:" section.
  // We fetch PDPs in-browser (credentials: include) to stay within the session.
  // ---------------------------------------------------------------------------
  const allSkus = [...productsByItemNumber.keys()];
  console.log(
    `[scrape_costco] Phase 3: enriching ${allSkus.length} products with PDP data...`,
  );

  const ENRICH_CONCURRENCY = 4;
  const ENRICH_CHUNK = 60;
  let totalEnriched = 0;

  page.setDefaultTimeout(0);

  for (let i = 0; i < allSkus.length; i += ENRICH_CHUNK) {
    const chunk = allSkus.slice(i, i + ENRICH_CHUNK);
    const pdpItems = chunk.map((sku) => ({
      sku,
      // Costco PDP URL pattern
      pdpUrl: `${COSTCO_BASE}/p/${sku}.product.${sku}.html`,
    }));

    const enrichResults = await page.evaluate(
      async ({ items, concurrency }) => {
        const results = {};

        async function enrichOne({ sku, pdpUrl }) {
          const entry = (results[sku] = {
            nutrition: null,
            ingredients: null,
            description: null,
          });
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
            if (!resp.ok) return;

            const html = await resp.text();

            // Extract Nutrition Facts block (plain text after stripping HTML)
            const nutIdx = html.indexOf("Nutrition Facts");
            if (nutIdx !== -1) {
              const slice = html.substring(nutIdx, nutIdx + 2000);
              entry.nutrition = slice
                .replace(/<[^>]+>/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim();
            }

            // Extract Ingredients section
            const ingMatch = html.match(
              /Ingredients?:?\s*([A-Z][^<]{15,600})(?:<|\.|$)/i,
            );
            if (ingMatch) {
              entry.ingredients = ingMatch[1]
                .replace(/<[^>]+>/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim();
            }

            // Try application/ld+json for description
            const ldMatches = html.matchAll(
              /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
            );
            for (const m of ldMatches) {
              try {
                const d = JSON.parse(m[1]);
                if (d.description && !entry.description) {
                  entry.description = d.description;
                }
              } catch (_) {}
            }
          } catch (_) {}
        }

        for (let j = 0; j < items.length; j += concurrency) {
          await Promise.all(
            items.slice(j, j + concurrency).map((item) => enrichOne(item)),
          );
          await new Promise((r) => setTimeout(r, 100));
        }
        return results;
      },
      { items: pdpItems, concurrency: ENRICH_CONCURRENCY },
    );

    for (const sku of chunk) {
      const detail = enrichResults[sku];
      if (!detail) continue;
      const raw = productsByItemNumber.get(sku);
      if (!raw) continue;
      if (detail.nutrition) {
        raw.nutrition = detail.nutrition;
        totalEnriched++;
      }
      if (detail.ingredients) raw.ingredients = detail.ingredients;
      if (detail.description && !raw.description)
        raw.description = detail.description;
      productsByItemNumber.set(sku, raw);
    }

    console.log(
      `[scrape_costco] Enrichment: ${Math.min(i + ENRICH_CHUNK, allSkus.length)}` +
        `/${allSkus.length} processed (${totalEnriched} enriched)`,
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
    if (!sku || !name) continue;

    items.push({
      store: "COSTCO",
      sku,
      name,
      price: extractPrice(raw),
      weight: extractUnitSize(raw) || null,
      categories: extractCategories(raw, raw._categorySlug || null),
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

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2), "utf8");
  console.log(`[scrape_costco] Wrote ${items.length} items to ${OUTPUT_PATH}`);

  const meta = {
    totalProducts: items.length,
    withNutrition: items.filter((i) => i.nutrition).length,
    withIngredients: items.filter((i) => i.ingredients).length,
    categoriesScraped: FOOD_CATEGORIES.length,
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
