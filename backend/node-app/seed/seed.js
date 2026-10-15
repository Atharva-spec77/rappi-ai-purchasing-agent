// Seed script: realistic demo data. Every location is tuned to show one decision path.
//   Cola  @ BOG-DC-01 -> ACCEPT 800 (Scenario 1 happy path)
//   Cola  @ MDE-DC-02 -> MODIFY to 250 (recommendation too large)
//   Cola  @ CLO-DC-03 -> MODIFY to 550 (budget limit)
//   Cola  @ BAQ-DC-04 -> MODIFY to 300 (storage limit)
//   Rice  @ MDE-DC-02 -> REJECT (stock already covers demand)
//   Oil   @ BOG-DC-01 -> INVESTIGATE (supplier unavailable)
//   Rice  @ CLO-DC-03 -> INVESTIGATE (no inventory/forecast data)
require('dotenv').config();
const { connectDb, disconnectDb } = require('../src/config/db');
const M = require('../src/models');

async function seedData() {
  await Promise.all(Object.values(M).map((Model) => Model.deleteMany({})));

  await M.Product.insertMany([
    { sku: 'SKU-COLA-500', name: 'Cola 500ml (24-pack)', category: 'Beverages', unitPrice: 7.5, storageUnitsPerPallet: 60 },
    { sku: 'SKU-RICE-5KG', name: 'Rice 5kg bag', category: 'Pantry', unitPrice: 4.2, storageUnitsPerPallet: 80 },
    { sku: 'SKU-OIL-1L', name: 'Vegetable Oil 1L', category: 'Pantry', unitPrice: 3.1, storageUnitsPerPallet: 72 },
  ]);

  await M.Inventory.insertMany([
    { sku: 'SKU-COLA-500', locationId: 'BOG-DC-01', onHand: 420, reserved: 60, safetyStock: 200 },
    { sku: 'SKU-COLA-500', locationId: 'MDE-DC-02', onHand: 1200, reserved: 100, safetyStock: 250 },
    { sku: 'SKU-COLA-500', locationId: 'CLO-DC-03', onHand: 100, reserved: 0, safetyStock: 150 },
    { sku: 'SKU-COLA-500', locationId: 'BAQ-DC-04', onHand: 150, reserved: 0, safetyStock: 150 },
    { sku: 'SKU-RICE-5KG', locationId: 'BOG-DC-01', onHand: 180, reserved: 20, safetyStock: 150 },
    { sku: 'SKU-RICE-5KG', locationId: 'MDE-DC-02', onHand: 2000, reserved: 100, safetyStock: 150 },
    { sku: 'SKU-OIL-1L', locationId: 'BOG-DC-01', onHand: 90, reserved: 10, safetyStock: 80 },
  ]);

  await M.DemandForecast.insertMany([
    { sku: 'SKU-COLA-500', locationId: 'BOG-DC-01', horizonDays: 30, expectedUnits: 1150, confidence: 0.82 },
    { sku: 'SKU-COLA-500', locationId: 'MDE-DC-02', horizonDays: 30, expectedUnits: 1100, confidence: 0.78 },
    { sku: 'SKU-COLA-500', locationId: 'CLO-DC-03', horizonDays: 30, expectedUnits: 800, confidence: 0.8 },
    { sku: 'SKU-COLA-500', locationId: 'BAQ-DC-04', horizonDays: 30, expectedUnits: 800, confidence: 0.8 },
    { sku: 'SKU-RICE-5KG', locationId: 'BOG-DC-01', horizonDays: 30, expectedUnits: 400, confidence: 0.9 },
    { sku: 'SKU-RICE-5KG', locationId: 'MDE-DC-02', horizonDays: 30, expectedUnits: 600, confidence: 0.88 },
    { sku: 'SKU-OIL-1L', locationId: 'BOG-DC-01', horizonDays: 30, expectedUnits: 300, confidence: 0.75 },
  ]);

  await M.Supplier.insertMany([
    { supplierId: 'SUP-ANDES-01', name: 'Andes Beverages Co.', sku: 'SKU-COLA-500', leadTimeDays: 5, minOrderQty: 100, orderMultiple: 50, unitPrice: 7.1, available: true },
    { supplierId: 'SUP-GRAIN-02', name: 'Grainero S.A.', sku: 'SKU-RICE-5KG', leadTimeDays: 10, minOrderQty: 200, orderMultiple: 100, unitPrice: 4.0, available: true },
    { supplierId: 'SUP-OILCO-03', name: 'OilCo Latam', sku: 'SKU-OIL-1L', leadTimeDays: 7, minOrderQty: 150, orderMultiple: 50, unitPrice: 2.95, available: false },
  ]);

  await M.Budget.insertMany([
    { locationId: 'BOG-DC-01', period: '2026-06', totalBudget: 80000, committed: 12000 },
    { locationId: 'MDE-DC-02', period: '2026-06', totalBudget: 50000, committed: 8000 },
    { locationId: 'CLO-DC-03', period: '2026-06', totalBudget: 4000, committed: 0 },
    { locationId: 'BAQ-DC-04', period: '2026-06', totalBudget: 60000, committed: 5000 },
  ]);

  await M.StorageCapacity.insertMany([
    { locationId: 'BOG-DC-01', totalPallets: 200, usedPallets: 140 },
    { locationId: 'MDE-DC-02', totalPallets: 300, usedPallets: 180 },
    { locationId: 'CLO-DC-03', totalPallets: 300, usedPallets: 50 },
    { locationId: 'BAQ-DC-04', totalPallets: 120, usedPallets: 115 },
  ]);

  // Pre-existing approved PO for Cola at BOG delivering 200 units within the horizon.
  await M.PurchaseOrder.create({
    poId: 'PO-SEED001', supplierId: 'SUP-ANDES-01', locationId: 'BOG-DC-01',
    items: [{ sku: 'SKU-COLA-500', quantity: 200, unitPrice: 7.1 }],
    totalCost: 1420, status: 'APPROVED', expectedArrival: new Date(Date.now() + 5 * 24 * 3600 * 1000),
    createdBy: 'seed', approvedBy: 'seed', isIncoming: true,
  });
}

async function seed() {
  await connectDb();
  await seedData();
  // eslint-disable-next-line no-console
  console.log('[seed] done.');
  await disconnectDb();
}

if (require.main === module) {
  seed().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { seed, seedData };
