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
        nutrition: null, // will be populated later from product detail page
        ingredients: null, // will be populated later from product detail page
        raw: node, // keep raw for debugging/mapping later
      });
    }
  });
  return products;
}

// Function to extract nutrition and ingredients from product detail page HTML/JSON
async function extractNutritionAndIngredients(page) {
  try {
    // Wait for page to load
    await page.waitForTimeout(3000);
    
    // Extract from embedded JSON data in script tags and DOM
    const domData = await page.evaluate(() => {
      // Look for nutrition facts in script tags with JSON data
      const scripts = Array.from(document.querySelectorAll('script[type="application/json"], script'));
      let nutritionFromScripts = null;
      let ingredientsFromScripts = null;
      
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent || '{}');
          
          // Recursively search for nutrition data
          function findInObject(obj, keys, depth = 0) {
            if (depth > 15) return null;
            if (!obj || typeof obj !== 'object') return null;
            
            for (const key of keys) {
              if (obj[key]) {
                return obj[key];
              }
            }
            
            // Recursively search
            for (const value of Object.values(obj)) {
              if (typeof value === 'object' && value !== null) {
                const result = findInObject(value, keys, depth + 1);
                if (result) return result;
              }
            }
            return null;
          }
          
          const nutritionKeys = ['nutritionFacts', 'nutrition', 'nutritionalInfo', 'nutritionFactsText', 'nutritionData'];
          const ingredientsKeys = ['ingredients', 'ingredientList', 'ingredientsText', 'ingredient'];
          
          if (!nutritionFromScripts) {
            const foundNutrition = findInObject(data, nutritionKeys);
            if (foundNutrition) {
              nutritionFromScripts = typeof foundNutrition === 'string' 
                ? foundNutrition 
                : JSON.stringify(foundNutrition);
            }
          }
          
          if (!ingredientsFromScripts) {
            const foundIngredients = findInObject(data, ingredientsKeys);
            if (foundIngredients) {
              ingredientsFromScripts = typeof foundIngredients === 'string' 
                ? foundIngredients 
                : JSON.stringify(foundIngredients);
            }
          }
        } catch (e) {
          // Not valid JSON, continue
        }
      }
      
      // Try to extract from DOM elements
      // Nutrition selectors
      const nutritionSection = document.querySelector('[class*="nutrition"], [id*="nutrition"], [data-nutrition], .nutrition-facts, [class*="NutritionFacts"]');
      
      // Ingredients selectors - Trader Joe's specific structure
      // Structure: <div class="IngredientsSummary_ingredientsSummary__..."><ul class="IngredientsList_ingredientsList__..."><li class="IngredientsList_ingredientsList__item__...">...</li></ul></div>
      // Use partial class matching since class names have hash suffixes (e.g., __1WMGh)
      let ingredientsSection = document.querySelector('[class*="IngredientsSummary"], [class*="ingredientsSummary"]');
      
      // Fallback to other ingredient selectors
      if (!ingredientsSection) {
        ingredientsSection = document.querySelector('[class*="ingredient"], [id*="ingredient"], [data-ingredient], .ingredients, [class*="Ingredients"]');
      }
      
      let nutrition = nutritionFromScripts;
      let ingredients = ingredientsFromScripts;
      
      if (nutritionSection && !nutrition) {
        const nutritionText = nutritionSection.textContent || nutritionSection.innerText;
        nutrition = nutritionText.trim();
      }
      
      // Extract ingredients from Trader Joe's specific structure
      if (ingredientsSection && !ingredients) {
        // Try to get the ul list directly (class contains "IngredientsList" or "ingredientsList")
        const ingredientsList = ingredientsSection.querySelector('ul[class*="IngredientsList"], ul[class*="ingredientsList"]');
        
        if (ingredientsList) {
          // Get all li items (class contains "item" or just any li in the list)
          const items = Array.from(ingredientsList.querySelectorAll('li[class*="item"], li'));
          if (items.length > 0) {
            // Join all list items with commas
            ingredients = items.map(li => li.textContent.trim()).filter(text => text.length > 0).join(', ');
          }
        }
        
        // If we didn't get ingredients from the list, try getting all text from the section
        if (!ingredients) {
          const ingredientsText = ingredientsSection.textContent || ingredientsSection.innerText;
          // Clean up the text - remove "Ingredients" label if present
          ingredients = ingredientsText.replace(/^ingredients?\s*:?\s*/i, '').trim();
        }
      }
      
      // Try to find ingredients in common patterns in page text (fallback)
      if (!ingredients) {
        const ingredientsPatterns = [
          /ingredients?:[\s\S]{0,200}?([A-Z][^.!?]{20,500})/i,
          /contains:[\s\S]{0,200}?([A-Z][^.!?]{20,500})/i,
        ];
        
        const pageText = document.body.innerText || document.body.textContent || '';
        for (const pattern of ingredientsPatterns) {
          const match = pageText.match(pattern);
          if (match && match[1]) {
            ingredients = match[1].trim().split(/\n|\./)[0].substring(0, 2000);
            break;
          }
        }
      }
      
      // Try to find nutrition facts table
      if (!nutrition) {
        const nutritionTable = document.querySelector('table[class*="nutrition"], .nutrition-facts, [id*="nutrition"], table.nutrition');
        if (nutritionTable) {
          nutrition = nutritionTable.innerText || nutritionTable.textContent || '';
        }
      }
      
      return { nutrition: nutrition || null, ingredients: ingredients || null };
    });
    
    return domData;
    
  } catch (err) {
    console.error('Error extracting nutrition/ingredients from page:', err.message);
    return { nutrition: null, ingredients: null };
  }
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

  // Now scrape nutrition data and ingredients from product detail pages
  console.log("\n=== Scraping nutrition data and ingredients from product detail pages ===");
  const itemsArray = [...bySku.values()];
  let nutritionScrapedCount = 0;
  let nutritionSuccessCount = 0;
  
  // Create a new page for product detail scraping to avoid interfering with main page
  const detailPage = await context.newPage();
  
  for (let i = 0; i < itemsArray.length; i++) {
    const item = itemsArray[i];
    
    // Skip if already has nutrition data
    if (item.nutrition !== null || item.ingredients !== null) {
      continue;
    }
    
    nutritionScrapedCount++;
    
    try {
      // Try to find product URL from raw data
      let productUrl = null;
      const raw = item.raw || {};
      
      // Check for common URL patterns in raw data
      if (raw.url) {
        productUrl = raw.url.startsWith('http') ? raw.url : `https://www.traderjoes.com${raw.url}`;
      } else if (raw.slug) {
        // If slug already includes SKU, use it directly; otherwise append SKU
        productUrl = raw.slug.includes(item.sku) 
          ? `https://www.traderjoes.com/home/products/pdp/${raw.slug}`
          : `https://www.traderjoes.com/home/products/pdp/${raw.slug}-${item.sku}`;
      } else if (raw.item_url) {
        productUrl = raw.item_url.startsWith('http') ? raw.item_url : `https://www.traderjoes.com${raw.item_url}`;
      } else {
        // Construct URL from product name (slugified) + SKU
        // Pattern: https://www.traderjoes.com/home/products/pdp/{slugified-name}-{sku}
        // Example: "Shredded Swiss Cheese & Gruyère Cheese" -> "shredded-swiss-cheese-gruyere-cheese-093847"
        const slug = item.name
          .toLowerCase()
          .normalize('NFD')  // Decompose accented characters (è -> e + ̀)
          .replace(/[\u0300-\u036f]/g, '')  // Remove accent marks
          .replace(/[&]/g, '')  // Remove ampersands
          .replace(/[^a-z0-9\s]+/g, '')  // Remove other special chars except spaces
          .trim()
          .replace(/\s+/g, '-')  // Replace spaces with hyphens
          .replace(/^-+|-+$/g, '');  // Remove leading/trailing hyphens
        productUrl = `https://www.traderjoes.com/home/products/pdp/${slug}-${item.sku}`;
      }
      
      if (!productUrl) {
        console.log(`⚠️  Skipping ${item.sku} (${item.name}): No product URL found`);
        continue;
      }
      
      if (i % 10 === 0) {
        console.log(`Progress: ${i + 1}/${itemsArray.length} products processed...`);
      }
      
      // Navigate to product detail page
      try {
        await detailPage.goto(productUrl, { 
          waitUntil: "domcontentloaded", 
          timeout: 15000 
        });
        
        // Extract nutrition and ingredients
        const { nutrition, ingredients } = await extractNutritionAndIngredients(detailPage);
        
        if (nutrition || ingredients) {
          // Update the item in the map
          item.nutrition = nutrition;
          item.ingredients = ingredients;
          bySku.set(item.sku, item);
          nutritionSuccessCount++;
          
          if (nutrition || ingredients) {
            console.log(`✓ ${item.sku}: ${nutrition ? 'nutrition' : ''} ${ingredients ? 'ingredients' : ''} found`);
          }
        }
        
        // Random delay to avoid rate limiting
        await detailPage.waitForTimeout(1000 + Math.random() * 1000);
        
      } catch (navErr) {
        // Page might not exist or URL format might be wrong, continue
        if (navErr.message.includes('404') || navErr.message.includes('net::ERR')) {
          // Skip silently for 404s
        } else {
          console.log(`⚠️  Error navigating to ${item.sku}: ${navErr.message}`);
        }
      }
      
    } catch (err) {
      console.error(`Error processing ${item.sku}:`, err.message);
    }
    
    // Save progress every 50 products
    if (nutritionScrapedCount % 50 === 0) {
      saveItems(null, bySku);
      console.log(`💾 Progress saved: ${nutritionSuccessCount}/${nutritionScrapedCount} products with nutrition data`);
    }
  }
  
  await detailPage.close();
  
  console.log(`\n✅ Finished nutrition scraping: ${nutritionSuccessCount}/${nutritionScrapedCount} products processed successfully`);

  const items = [...bySku.values()];
  console.log("\n=== Summary ===");
  console.log("Captured items:", items.length);
  console.log("Products with nutrition data:", items.filter(i => i.nutrition || i.ingredients).length);
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

