// Post-commit outcome validation. After a PO is committed we re-read it from
// Mongo and verify that the persisted state matches what we intended.
const M = require('../models');

async function validateCommittedOrder({ poId, expected }) {
  const po = await M.PurchaseOrder.findOne({ poId }).lean();
  const checks = [];
  if (!po) {
    const v = { poId, passed: false, checks: [{ name: 'persisted', passed: false, detail: 'PO not found in DB' }] };
    await M.Validation.create(v);
    return v;
  }
  const actualItem = (po.items || [])[0] || {};
  checks.push({ name: 'persisted', passed: true, expected: true, actual: true, detail: 'PO exists in DB' });
  checks.push({ name: 'status-submitted', passed: po.status === 'SUBMITTED', expected: 'SUBMITTED', actual: po.status });
  checks.push({ name: 'product-matches', passed: actualItem.sku === expected.sku, expected: expected.sku, actual: actualItem.sku });
  checks.push({ name: 'quantity-matches', passed: actualItem.quantity === expected.quantity, expected: expected.quantity, actual: actualItem.quantity });
  checks.push({ name: 'supplier-matches', passed: po.supplierId === expected.supplierId, expected: expected.supplierId, actual: po.supplierId });
  checks.push({ name: 'unit-cost-matches', passed: actualItem.unitPrice === expected.unitPrice, expected: expected.unitPrice, actual: actualItem.unitPrice });
  checks.push({ name: 'total-cost-matches', passed: po.totalCost === expected.totalCost, expected: expected.totalCost, actual: po.totalCost });
  const budget = await M.Budget.findOne({ locationId: po.locationId }).lean();
  const storage = await M.StorageCapacity.findOne({ locationId: po.locationId }).lean();
  checks.push({ name: 'budget-not-overdrawn', passed: budget ? (budget.committed || 0) <= (budget.totalBudget || 0) : true, expected: `<= ${budget?.totalBudget}`, actual: budget?.committed });
  checks.push({ name: 'storage-not-overbooked', passed: storage ? (storage.usedPallets || 0) <= (storage.totalPallets || 0) : true, expected: `<= ${storage?.totalPallets}`, actual: storage?.usedPallets });
  const passed = checks.every((c) => c.passed);
  const v = await M.Validation.create({ poId, passed, checks });
  return v.toObject();
}

module.exports = { validateCommittedOrder };
