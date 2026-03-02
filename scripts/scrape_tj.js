"use strict";

/**
 * scrape_tj.js — Trader Joe's product catalog fetcher
 *
 * Queries TJ's GraphQL API directly (no browser required).
 * Paginates through all pages and writes tj-items.json.
 *
 * Usage:
 *   node scrape_tj.js [--output <path>] [--meta <path>]
 */

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
const GRAPHQL_URL = "https://www.traderjoes.com/api/graphql";
const STORE_CODE = "701"; // Chicago South Loop — representative catalog
const PAGE_SIZE = 100;
const MAX_PAGES = 200; // safety ceiling
const TJ_BASE = "https://www.traderjoes.com";

// ---------------------------------------------------------------------------
// GraphQL query — mirrors the fields used by import_tj.py
// ---------------------------------------------------------------------------
const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($pageSize: Int, $currentPage: Int, $storeCode: String, $published: String) {
    products(
      filter: { store_code: { eq: $storeCode }, published: { eq: $published } }
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      items {
        sku
        item_title
        primary_image
        primary_image_meta { url }
        retail_price
        sales_size
        sales_uom_description
        category_hierarchy { name }
        fun_tags
        item_characteristics
        item_description
        item_story_qil
        alignment_simple_description
      }
      page_info {
        current_page
        page_size
        total_pages
      }
      total_count
    }
  }
`;

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
  return hier.map((c) => c.name).join(" > ") || null;
}

function extractPrice(raw) {
  const retail = raw.retail_price;
  if (retail != null) {
    const n = parseFloat(retail);
    if (!isNaN(n)) return n;
  }
  return null;
}

async function fetchPage(currentPage) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      query: SEARCH_PRODUCTS_QUERY,
      variables: {
        storeCode: STORE_CODE,
        published: "1",
        pageSize: PAGE_SIZE,
        currentPage,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on page ${currentPage}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data.products;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[scrape_tj] Starting. Output: ${OUTPUT_PATH}`);
  console.log(`[scrape_tj] Querying ${GRAPHQL_URL} (store: ${STORE_CODE})`);

  const productsBySku = new Map();
  let totalPages = null;
  let totalCount = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetchPage(page);

    if (totalPages === null) {
      totalPages = data.page_info.total_pages;
      totalCount = data.total_count;
      console.log(
        `[scrape_tj] Total: ${totalCount} items across ${totalPages} pages`,
      );
    }

    for (const raw of data.items || []) {
      const sku = String(raw.sku);
      if (!productsBySku.has(sku)) {
        productsBySku.set(sku, raw);
      }
    }

    console.log(
      `[scrape_tj] Page ${page}/${totalPages}: ${productsBySku.size} unique items so far`,
    );

    if (page >= totalPages) break;
  }

  // ---------------------------------------------------------------------------
  // Build output in the format import_tj.py expects
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
      nutrition: null,
      ingredients: null,
      raw,
    });
  }

  if (items.length < 100) {
    console.error(
      `[scrape_tj] ERROR: Only ${items.length} items collected — ` +
        "expected at least 100. Possible API change. Exiting with error.",
    );
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2), "utf8");
  console.log(`[scrape_tj] Wrote ${items.length} items to ${OUTPUT_PATH}`);

  const meta = {
    totalProducts: items.length,
    totalCount,
    totalPages,
    storeCode: STORE_CODE,
    graphqlUrl: GRAPHQL_URL,
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
