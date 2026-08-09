const repository = require('./productBarcode.repository');

/**
 * Validate barcode input – digits only, trim, length 8‑14 (EAN/UPC/GTIN)
 */
function validateBarcode(barcode) {
  if (typeof barcode !== 'string') throw { code: 'VALIDATION_ERROR', error: 'Barcode must be a string.' };
  const trimmed = barcode.trim();
  if (!/^\d{8,14}$/.test(trimmed)) throw { code: 'VALIDATION_ERROR', error: 'Invalid barcode format. Must be 8‑14 digits.' };
  return trimmed;
}

/**
 * Fetch product info from Open Food Facts (OFF).
 * Returns a normalized product object or null if not found.
 */
async function fetchFromOpenFoodFacts(barcode) {
  const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const quantity = p.product_quantity ? parseFloat(p.product_quantity) : null; // g or ml
    const unit = p.product_quantity_unit || null; // e.g. 'g', 'ml'
    let quantityValue = null, quantityUnit = null;
    if (unit === 'ml') {
      quantityValue = quantity / 1000; // convert to L
      quantityUnit = 'L';
    } else if (unit === 'cl') {
      quantityValue = quantity / 100;
      quantityUnit = 'L';
    } else if (unit === 'g') {
      quantityValue = quantity / 1000; // convert to kg? keep as g for now, or use kg?
      // We'll keep g as is, and set unit 'g'
      quantityValue = quantity;
      quantityUnit = 'g';
    } else {
      quantityValue = quantity;
      quantityUnit = unit;
    }

    return {
      name: p.product_name || p.generic_name || null,
      brand: p.brands || null,
      description: p.generic_name || null,
      category: p.categories || null,
      quantityValue: quantityValue,
      quantityUnit: quantityUnit,
      packageQuantity: null,   // OFF doesn't reliably provide carton qty
      packageUnit: null,
      provider: 'open_food_facts',
      providerProductId: p.code || barcode
    };
  } catch (err) {
    console.error('OFF fetch error:', err);
    return null;
  }
}

/**
 * Lookup a barcode: cache first, then external, then match to inventory.
 */
async function lookupBarcode(restaurantId, barcode) {
  const cleanBarcode = validateBarcode(barcode);

  // 1. Check local cache
  let cached = await repository.findCachedProduct(restaurantId, cleanBarcode);
  let product = cached;

  if (!cached) {
    // 2. External lookup
    const externalProduct = await fetchFromOpenFoodFacts(cleanBarcode);
    if (externalProduct) {
      // 3. Save to cache
      await repository.saveCachedProduct(restaurantId, cleanBarcode, externalProduct);
      product = externalProduct;
    } else {
      // Not found externally
      return {
        barcode: cleanBarcode,
        found: false,
        product: null,
        inventoryMatch: null,
        source: null
      };
    }
  }

  // 4. Try to match an existing inventory item
  const matchedItem = await repository.findInventoryItemByName(restaurantId, product.name);

  return {
    ok: true,
    barcode: cleanBarcode,
    found: true,
    product: {
      name: product.product_name || product.name,
      brand: product.brand,
      description: product.description,
      category: product.category,
      quantityValue: product.quantity_value || product.quantityValue,
      quantityUnit: product.quantity_unit || product.quantityUnit,
      packageQuantity: product.package_quantity || product.packageQuantity,
      packageUnit: product.package_unit || product.packageUnit
    },
    inventoryMatch: matchedItem ? {
      matched: true,
      itemId: matchedItem.id,
      itemName: matchedItem.name
    } : {
      matched: false,
      itemId: null,
      itemName: null
    },
    source: product.provider || 'cache'
  };
}

module.exports = { lookupBarcode };