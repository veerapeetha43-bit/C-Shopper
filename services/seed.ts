/**
 * seed.ts — demo seed catalog for C-Shopper.
 *
 * DEMO SEED DATA — replaced by real receipt scans. On first launch, when the
 * catalog (ws_global_prices) is empty, App.tsx seeds it with the items below
 * so search, category chips and the item-detail modal work out of the box.
 * Seeding runs ONLY when the catalog is empty, so user-scanned data is never
 * overwritten on later launches. To change the seed, edit SEED_CATALOG here.
 */
import type { GlobalPriceEntry } from '../types';

interface SeedRow {
  itemNumber: string;
  itemName: string;
  price: number;
  category: string;
  unitPrice?: number;
  unit?: string;
}

const SEED_ROWS: SeedRow[] = [
  // Pantry
  { itemNumber: '123456', itemName: 'Kirkland Signature Organic Extra Virgin Olive Oil 2L', price: 24.99, category: 'Pantry', unitPrice: 0.37, unit: 'fl oz' },
  { itemNumber: '234567', itemName: 'Kirkland Signature Organic Peanut Butter 2 x 28oz', price: 12.99, category: 'Pantry' },
  { itemNumber: '345678', itemName: 'Kirkland Signature Thai Hom Mali Jasmine Rice 25lb', price: 32.99, category: 'Pantry', unitPrice: 0.08, unit: 'oz' },
  { itemNumber: '456789', itemName: 'Kirkland Signature Organic Quinoa 4.5lb', price: 13.49, category: 'Pantry' },
  { itemNumber: '567890', itemName: "Kirkland Signature Pure Vanilla Extract 16oz", price: 29.99, category: 'Pantry' },
  { itemNumber: '678901', itemName: 'Kirkland Signature Raw Unfiltered Honey 3lb', price: 16.99, category: 'Pantry' },
  { itemNumber: '789012', itemName: 'Kirkland Signature Creamy Almond Butter 27.5oz', price: 13.79, category: 'Pantry' },
  { itemNumber: '890123', itemName: 'Kirkland Signature Chicken Breast in Water 6 x 12.5oz', price: 13.99, category: 'Pantry' },
  { itemNumber: '901234', itemName: "Rao's Homemade Marinara Sauce 2 x 28oz", price: 10.99, category: 'Pantry' },
  { itemNumber: '112233', itemName: 'Kirkland Signature Organic Maple Syrup 33.8oz', price: 14.99, category: 'Pantry' },
  // Household
  { itemNumber: '223344', itemName: 'Kirkland Signature Bath Tissue 2-Ply 30 Rolls', price: 24.99, category: 'Household', unitPrice: 0.83, unit: 'roll' },
  { itemNumber: '334455', itemName: 'Kirkland Signature Paper Towels 12 Rolls', price: 22.99, category: 'Household', unitPrice: 1.92, unit: 'roll' },
  { itemNumber: '445566', itemName: 'Tide Original Liquid Laundry Detergent 146oz', price: 28.99, category: 'Household' },
  { itemNumber: '556677', itemName: 'Kirkland Signature Dishwasher Pacs 115ct', price: 15.99, category: 'Household', unitPrice: 0.14, unit: 'pac' },
  { itemNumber: '667788', itemName: 'Dawn Platinum Dish Soap 3 x 24oz', price: 12.49, category: 'Household' },
  { itemNumber: '778899', itemName: 'Kirkland Signature Disinfecting Wipes 5 x 78ct', price: 14.99, category: 'Household' },
  { itemNumber: '889900', itemName: 'Bounty Select-A-Size Paper Towels 12 Rolls', price: 26.49, category: 'Household' },
  // Fresh
  { itemNumber: '990011', itemName: 'Kirkland Signature Rotisserie Chicken 3lb', price: 4.99, category: 'Fresh' },
  { itemNumber: '101112', itemName: 'Kirkland Signature Organic Whole Milk 2 x 1gal', price: 7.89, category: 'Fresh' },
  { itemNumber: '121314', itemName: 'Kirkland Signature Organic Large Brown Eggs 24ct', price: 7.99, category: 'Fresh', unitPrice: 0.33, unit: 'egg' },
  { itemNumber: '131415', itemName: 'Kirkland Signature Boneless Skinless Chicken Breasts 6lb', price: 19.99, category: 'Fresh', unitPrice: 3.33, unit: 'lb' },
  { itemNumber: '141516', itemName: 'Kirkland Signature Farmed Atlantic Salmon 3lb', price: 29.99, category: 'Fresh', unitPrice: 10.0, unit: 'lb' },
  { itemNumber: '151617', itemName: 'Organic Bananas 3lb Bag', price: 1.99, category: 'Fresh' },
  { itemNumber: '161718', itemName: 'Fresh Strawberries 2lb Clamshell', price: 5.99, category: 'Fresh' },
  // Frozen
  { itemNumber: '171819', itemName: 'Kirkland Signature Three Berry Blend 4lb', price: 10.99, category: 'Frozen' },
  { itemNumber: '181920', itemName: 'Kirkland Signature Organic Stir-Fry Vegetable Blend 5.5lb', price: 9.49, category: 'Frozen' },
  { itemNumber: '192021', itemName: 'Kirkland Signature Cheese Pizza 4ct', price: 12.99, category: 'Frozen' },
  { itemNumber: '202122', itemName: 'Kirkland Signature Raw Shrimp 21/25 2lb', price: 19.99, category: 'Frozen' },
  // Snacks
  { itemNumber: '212223', itemName: 'Kirkland Signature Extra Fancy Mixed Nuts 2.5lb', price: 16.99, category: 'Snacks' },
  { itemNumber: '222324', itemName: 'Kirkland Signature Trail Mix 4lb', price: 13.99, category: 'Snacks' },
  { itemNumber: '232425', itemName: 'SkinnyPop Original Popcorn 24ct', price: 11.99, category: 'Snacks' },
  { itemNumber: '242526', itemName: 'Kirkland Signature Protein Bars Variety 20ct', price: 19.99, category: 'Snacks', unitPrice: 1.0, unit: 'bar' },
  { itemNumber: '252627', itemName: 'Kind Dark Chocolate Nuts & Sea Salt Bars 30ct', price: 17.49, category: 'Snacks' },
  // Beverages
  { itemNumber: '262728', itemName: 'Kirkland Signature Purified Water 40 x 16.9oz', price: 5.99, category: 'Beverages', unitPrice: 0.15, unit: 'bottle' },
  { itemNumber: '272829', itemName: 'Kirkland Signature Organic Cold Brew Coffee 11 x 11oz', price: 15.99, category: 'Beverages' },
  { itemNumber: '282930', itemName: 'Gatorade Variety Pack 28 x 12oz', price: 16.99, category: 'Beverages' },
  { itemNumber: '293031', itemName: 'Kirkland Signature Organic Coconut Water 12 x 33.8oz', price: 15.49, category: 'Beverages' },
  // Electronics
  { itemNumber: '303132', itemName: 'Apple AirPods Pro 2nd Generation with MagSafe', price: 169.99, category: 'Electronics' },
  { itemNumber: '313233', itemName: 'LG 55" Class C4 evo OLED 4K Smart TV', price: 1296.99, category: 'Electronics' },
  { itemNumber: '323334', itemName: 'Kirkland Signature 10ft Lightning Cable 3pk', price: 19.99, category: 'Electronics' },
];

/** Marker key so we never re-seed over user data. */
export const SEED_MARKER_KEY = 'ws_catalog_seeded';

/**
 * Build the seed catalog for the given warehouse. updatedAt is stamped at
 * seed time so "Updated" labels look alive on first launch.
 */
export function buildSeedCatalog(warehouseId: string, zipCode: string): GlobalPriceEntry[] {
  const now = new Date().toISOString();
  return SEED_ROWS.map((r) => ({
    itemNumber: r.itemNumber,
    itemName: r.itemName,
    price: r.price,
    unitPrice: r.unitPrice,
    unit: r.unit,
    warehouseId,
    zipCode,
    updatedAt: now,
    stockStatus: 'high' as const,
    category: r.category,
  }));
}
