import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.join(__dirname, "tj-items.json");
const METADATA_FILE = path.join(__dirname, "tj-metadata.json");

const START_URL = "https://www.traderjoes.com/home/products/category/food-8";

// Function to save items to file
function saveItems(items, bySku) {
  try {
    const itemsArray = items || [...bySku.values()];
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(itemsArray, null, 2));
    console.log(`\n💾 Saved ${itemsArray.length} items to ${OUTPUT_FILE}`);
    return true;
  } catch (err) {
    console.error("Error saving file:", err.message);
    return false;
  }
}

// Function to save metadata
function saveMetadata(metadata) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
    console.log(`\n📊 Saved metadata to ${METADATA_FILE}`);
    return true;
  } catch (err) {
    console.error("Error saving metadata:", err.message);
    return false;
  }
}

function walk(obj, cb) {
  if (!obj || typeof obj !== "object") return;
  cb(obj);
  if (Array.isArray(obj)) {
    for (const v of obj) walk(v, cb);
  } else {
    for (const v of Object.values(obj)) walk(v, cb);
  }
}

function extractProductsFromGraphqlPayload(payload) {
  const products = [];
  walk(payload, (node) => {
    // Heuristic: anything that looks like a product record
    // (You’ll see the real keys once you run it; this works for many TJ payload shapes)
    if (
      node &&
      typeof node === "object" &&
      (node.sku || node.productSku || node.itemSku) &&
      (node.name || node.productName || node.item_title || node.title)
    ) {
      const sku = String(node.sku ?? node.productSku ?? node.itemSku);
      const name = String(node.name ?? node.productName ?? node.item_title ?? node.title);

      // Price can be nested / optional
      const price =
        node.price ??
        node.retail_price ??
        node?.pricing?.price ??
        node?.pricing?.retailPrice ??
        null;

      // Weight/size often appears as "netWeight", "size", "uom", etc.
      const weight =
        node.netWeight ??
        node.size ??
        node?.packageSize ??
        node?.weight ??
        null;

      // Categories/tags may be arrays
      // Trader Joe's uses category_hierarchy as array of objects with name fields
      let categories = null;
      if (node.category_hierarchy && Array.isArray(node.category_hierarchy)) {
        // Extract category names from hierarchy, skip the root "Products" category
        const categoryNames = node.category_hierarchy
          .map(cat => cat?.name)
          .filter(Boolean)
          .filter(name => name !== "Products");
        if (categoryNames.length > 0) {
          categories = categoryNames.join(" > ");
        }
      } else {
        categories =
          node.categories ??
          node.tags ??
          node?.taxonomy ??
          node?.categoryPath ??
          null;
      }

      products.push({
        store: "TRADER_JOES",
        sku,
        name,
        price: price == null ? null : Number(price),
        weight: weight == null ? null : String(weight),
        categories,
        raw: node, // keep raw for debugging/mapping later
      });
    }
  });
  return products;
}

(async () => {
  const bySku = new Map();
  const allRequests = [];
  let browser = null;
  let context = null;
  let page = null;
  let metadataState = {
    scrollIterations: 0,
    loadMoreClickedCount: 0,
    noNewProductsCount: 0
  };

  // Setup signal handlers for graceful shutdown
  const cleanup = async () => {
    console.log("\n\n⚠️  Interrupted! Saving current progress...");
    const items = [...bySku.values()];
    saveItems(items, bySku);
    
    // Save metadata for interrupted run
    const metadata = {
      totalProducts: items.length,
      endReason: "interrupted",
      scrollIterations: metadataState.scrollIterations,
      loadMoreClickedCount: metadataState.loadMoreClickedCount,
      noNewProductsCount: metadataState.noNewProductsCount,
      startUrl: START_URL,
      timestamp: new Date().toISOString(),
      networkRequests: allRequests.length,
      jsonResponses: allRequests.filter(r => r.type === "response" && r.contentType?.includes("json")).length
    };
    saveMetadata(metadata);
    
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', cleanup);  // Ctrl+C
  process.on('SIGTERM', cleanup); // Termination signal

  try {

  // Launch browser with realistic settings to avoid bot detection
  browser = await chromium.launch({ 
    headless: false, // Use visible browser to avoid detection
    args: [
      '--disable-blink-features=AutomationControlled', // Remove automation flags
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });
  
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    permissions: [],
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    },
  });

  page = await context.newPage();
  
  // Remove webdriver property to avoid detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Override plugins to look more realistic
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });

  const bySku = new Map();
  const allRequests = [];

  // Log ALL requests to understand what's happening
  page.on("request", (req) => {
    const url = req.url();
    // Log interesting requests
    if (url.includes("api") || url.includes("graphql") || url.includes("product") || 
        url.includes("json") || url.includes("data") || url.includes("search")) {
      console.log("Request:", req.method(), url);
      allRequests.push({ type: "request", method: req.method(), url });
    }
  });

  page.on("response", async (res) => {
    try {
      const url = res.url();
      const status = res.status();
      const ct = res.headers()["content-type"] || "";
      
      // Log ALL JSON responses and interesting URLs
      if (ct.includes("application/json") || 
          url.includes("api") || url.includes("graphql") || url.includes("product") ||
          url.includes("json") || url.includes("data")) {
        console.log(`Response [${status}]:`, url, "Content-Type:", ct);
        allRequests.push({ type: "response", status, url, contentType: ct });
      }
      
      // Only process JSON responses
      if (!ct.includes("application/json")) {
        return;
      }

      const data = await res.json();
      console.log("✓ Parsed JSON from:", url);
      console.log("Sample data structure:", JSON.stringify(data).substring(0, 500));
      
      const found = extractProductsFromGraphqlPayload(data);
      console.log(`Found ${found.length} products in this response`);

      for (const p of found) {
        if (!bySku.has(p.sku)) bySku.set(p.sku, p);
      }
    } catch (err) {
      // Log errors instead of silently ignoring
      console.error("Error processing response:", err.message);
    }
  });

  console.log("Opening:", START_URL);
  
  // Navigate with realistic timing
  await page.goto(START_URL, { 
    waitUntil: "networkidle",
    timeout: 30000 
  });
  
  console.log("Page loaded, waiting for initial API calls...");
  await page.waitForTimeout(2000); // Give page time to make initial API calls
  
  // Simulate human-like mouse movement
  await page.mouse.move(100, 100);
  await page.waitForTimeout(500);

  // Check if products are embedded in the page HTML/JavaScript
  console.log("\n=== Checking for embedded product data ===");
  try {
    // Look for JSON data in script tags
    const scriptTags = await page.$$eval("script[type='application/json'], script", (scripts) => {
      return scripts.map((s) => s.textContent).filter(Boolean);
    });
    
    for (let i = 0; i < scriptTags.length; i++) {
      const scriptContent = scriptTags[i];
      if (scriptContent.length > 100 && (scriptContent.includes("product") || scriptContent.includes("sku"))) {
        console.log(`Found potential product data in script tag ${i}, length: ${scriptContent.length}`);
        try {
          const data = JSON.parse(scriptContent);
          const found = extractProductsFromGraphqlPayload(data);
          if (found.length > 0) {
            console.log(`✓ Found ${found.length} products in embedded script tag!`);
            for (const p of found) {
              if (!bySku.has(p.sku)) bySku.set(p.sku, p);
            }
          }
        } catch {
          // Not JSON, might be JavaScript code
          if (scriptContent.includes("product") || scriptContent.includes("sku")) {
            console.log(`Script tag ${i} contains product-related code (not JSON)`);
          }
        }
      }
    }

    // Check page title and see if we can find product elements
    const productElements = await page.$$("[data-product-id], [data-sku], .product, [class*='product']");
    console.log(`Found ${productElements.length} potential product elements in DOM`);
  } catch (err) {
    console.error("Error checking embedded data:", err.message);
  }
  console.log("=== End embedded data check ===\n");

  // Pagination: Keep scrolling and loading until all products are captured
  console.log("Starting pagination to load all products...");
  let previousCount = 0;
  let noNewProductsCount = 0;
  let scrollIterations = 0;
  let loadMoreClickedCount = 0;
  let loadMoreNoNewProductsCount = 0;
  const maxIterations = 2000; // Safety limit
  const maxNoNewProducts = 15; // Stop if no new products for 15 consecutive checks
  const maxLoadMoreNoNewProducts = 3; // Stop if "Load More" clicked but no new products 3 times
  let endReason = null;
  let loadMoreButtonExists = true;

  while (scrollIterations < maxIterations && noNewProductsCount < maxNoNewProducts) {
    // Scroll down to trigger lazy loading
    const scrollAmount = 500 + Math.random() * 1000;
    await page.mouse.wheel(0, scrollAmount);
    
    // Wait for potential API calls to complete
    await page.waitForTimeout(1000 + Math.random() * 500);
    
    // Check if we got new products
    const currentCount = bySku.size;
    if (currentCount > previousCount) {
      console.log(`Progress: ${currentCount} products - gained ${currentCount - previousCount} new items`);
      previousCount = currentCount;
      noNewProductsCount = 0; // Reset counter when we get new products
      loadMoreNoNewProductsCount = 0; // Reset if we got new products after clicking Load More
      
      // Save periodically (every 50 iterations or every 100 new products)
      if (scrollIterations % 50 === 0 || (currentCount > 0 && currentCount % 100 === 0)) {
        saveItems(null, bySku);
      }
    } else {
      noNewProductsCount++;
      if (noNewProductsCount % 5 === 0) {
        console.log(`No new products for ${noNewProductsCount} checks (current: ${currentCount} products)`);
        // Save when we haven't gotten new products for a while (in case of interruption)
        saveItems(null, bySku);
      }
    }
    
    scrollIterations++;
    metadataState.scrollIterations = scrollIterations;
    metadataState.noNewProductsCount = noNewProductsCount;
    
    // Check for "Load More" button and detect if we've reached the end
    try {
      const loadMoreButton = await page.$('button:has-text("Load More"), button:has-text("Show More"), a:has-text("Next"), button[aria-label*="more" i], button[aria-label*="next" i]');
      if (loadMoreButton) {
        const isVisible = await loadMoreButton.isVisible();
        const isDisabled = await loadMoreButton.isDisabled().catch(() => false);
        
        if (isVisible && !isDisabled) {
          const countBeforeClick = bySku.size;
          console.log("Found 'Load More' button, clicking...");
          loadMoreClickedCount++;
          metadataState.loadMoreClickedCount = loadMoreClickedCount;
          await loadMoreButton.click();
          await page.waitForTimeout(3000); // Wait for new products to load
          
          // Check if we got new products after clicking
          const countAfterClick = bySku.size;
          if (countAfterClick === countBeforeClick) {
            loadMoreNoNewProductsCount++;
            console.log(`⚠️  Clicked 'Load More' but no new products (${loadMoreNoNewProductsCount}/${maxLoadMoreNoNewProducts})`);
            
            if (loadMoreNoNewProductsCount >= maxLoadMoreNoNewProducts) {
              endReason = "load_more_no_new_products";
              console.log("\n✅ Reached end: 'Load More' button clicked but no new products found");
              break;
            }
          } else {
            loadMoreNoNewProductsCount = 0; // Reset if we got new products
          }
          noNewProductsCount = 0; // Reset since we're loading more
        } else if (isDisabled) {
          endReason = "load_more_disabled";
          console.log("\n✅ Reached end: 'Load More' button is disabled");
          break;
        }
      } else {
        // No Load More button found - check if this is consistent
        if (loadMoreButtonExists) {
          console.log("⚠️  'Load More' button no longer found - may have reached end");
          loadMoreButtonExists = false;
          // Wait a bit and check again
          await page.waitForTimeout(2000);
          const checkAgain = await page.$('button:has-text("Load More"), button:has-text("Show More"), a:has-text("Next"), button[aria-label*="more" i], button[aria-label*="next" i]');
          if (!checkAgain) {
            endReason = "no_load_more_button";
            console.log("\n✅ Reached end: No 'Load More' button found");
            break;
          }
        }
      }
    } catch (err) {
      // Error checking for button, continue
    }
    
    // Occasionally move mouse to simulate human interaction
    if (Math.random() > 0.7) {
      const x = 100 + Math.random() * 800;
      const y = 100 + Math.random() * 600;
      await page.mouse.move(x, y);
    }
    
    // Scroll to bottom periodically to ensure we trigger any lazy loading
    if (scrollIterations % 15 === 0) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }
  }
  
  // Determine end reason if not already set
  if (!endReason) {
    if (noNewProductsCount >= maxNoNewProducts) {
      endReason = "no_new_products_timeout";
      console.log(`\n✅ Reached end: No new products detected after ${maxNoNewProducts} consecutive checks`);
    } else if (scrollIterations >= maxIterations) {
      endReason = "max_iterations_reached";
      console.log(`\n⚠️  Stopped: Reached maximum iteration limit (${maxIterations})`);
    } else {
      endReason = "unknown";
    }
  }
  
  const finalCount = bySku.size;
  console.log(`\n✅ Finished pagination. Total products captured: ${finalCount}`);

  const items = [...bySku.values()];
  console.log("\n=== Summary ===");
  console.log("Captured items:", items.length);
  console.log("Total network requests logged:", allRequests.length);
  console.log("Scroll iterations:", scrollIterations);
  console.log("Load More button clicked:", loadMoreClickedCount, "times");
  console.log("End reason:", endReason);
  
  if (allRequests.length > 0) {
    console.log("\nNetwork activity summary:");
    const jsonResponses = allRequests.filter(r => r.type === "response" && r.contentType?.includes("json"));
    console.log(`- JSON responses: ${jsonResponses.length}`);
    if (jsonResponses.length > 0) {
      console.log("  JSON response URLs:");
      jsonResponses.forEach(r => console.log(`    ${r.url}`));
    }
  }

  // Save metadata
  const metadata = {
    totalProducts: finalCount,
    endReason: endReason,
    scrollIterations: scrollIterations,
    loadMoreClickedCount: loadMoreClickedCount,
    noNewProductsCount: noNewProductsCount,
    startUrl: START_URL,
    timestamp: new Date().toISOString(),
    networkRequests: allRequests.length,
    jsonResponses: allRequests.filter(r => r.type === "response" && r.contentType?.includes("json")).length
  };
  saveMetadata(metadata);

  // Final save
  saveItems(items, bySku);
  } catch (err) {
    console.error("\n❌ Error occurred:", err.message);
    // Save whatever we have before exiting
    const items = [...bySku.values()];
    saveItems(items, bySku);
    throw err;
  } finally {
    // Ensure cleanup happens
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
})();

