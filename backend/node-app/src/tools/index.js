// Authorized agent tools. Each tool has a name, JSON schema for arguments,
// and an async executor that returns plain data. The LLM is only allowed to
// call these tools — it never writes to the DB directly.
const { v4: uuidv4 } = require('uuid');
const M = require('../models');
const purchasing = require('../services/purchasing');

const tools = {};

function defineTool({ name, description, parameters, run }) {
  tools[name] = { name, description, parameters, run };
}

defineTool({
  name: 'getInventory',
  description: 'Return on-hand, reserved and safety-stock for a sku at a location.',
  parameters: {
    type: 'object',
    properties: { sku: { type: 'string' }, locationId: { type: 'string' } },
    required: ['sku', 'locationId'],
  },
  async run({ sku, locationId }) {
    const inv = await M.Inventory.findOne({ sku, locationId }).lean();
    if (!inv) return { found: false };
    return { found: true, sku, locationId, onHand: inv.onHand, reserved: inv.reserved, safetyStock: inv.safetyStock, updatedAt: inv.updatedAt };
  },
});

defineTool({
  name: 'getDemandForecast',
  description: 'Return the latest expected demand over a planning horizon.',
  parameters: {
    type: 'object',
    properties: { sku: { type: 'string' }, locationId: { type: 'string' }, horizonDays: { type: 'number' } },
    required: ['sku', 'locationId'],
  },
  async run({ sku, locationId, horizonDays }) {
    const q = { sku, locationId };
    if (horizonDays) q.horizonDays = horizonDays;
    const f = await M.DemandForecast.findOne(q).sort({ generatedAt: -1 }).lean();
    if (!f) return { found: false };
    return { found: true, ...f };
  },
});

defineTool({
  name: 'getOpenPurchaseOrders',
  description: 'List open purchase orders for a sku/location that are expected to arrive.',
  parameters: {
    type: 'object',
    properties: { sku: { type: 'string' }, locationId: { type: 'string' } },
    required: ['sku', 'locationId'],
  },
  async run({ sku, locationId }) {
    const pos = await M.PurchaseOrder.find({
      locationId,
      status: { $in: ['APPROVED', 'SUBMITTED'] },
      'items.sku': sku,
    }).lean();
    return {
      count: pos.length,
      orders: pos.map((p) => ({ poId: p.poId, status: p.status, items: p.items, expectedArrival: p.expectedArrival })),
    };
  },
});

defineTool({
  name: 'getSupplierDetails',
  description: 'Return supplier terms for a sku: lead time, MOQ, order multiples, unit price.',
  parameters: {
    type: 'object',
    properties: { sku: { type: 'string' } },
    required: ['sku'],
  },
  async run({ sku }) {
    const s = await M.Supplier.findOne({ sku }).lean();
    if (!s) return { found: false };
    return { found: true, ...s };
  },
});

defineTool({
  name: 'getBudgetStatus',
  description: 'Return remaining purchasing budget for the current period at a location.',
  parameters: {
    type: 'object',
    properties: { locationId: { type: 'string' } },
    required: ['locationId'],
  },
  async run({ locationId }) {
    const b = await M.Budget.findOne({ locationId }).lean();
    if (!b) return { found: false };
    return { found: true, ...b, remaining: (b.totalBudget || 0) - (b.committed || 0) };
  },
});

defineTool({
  name: 'getStorageCapacity',
  description: 'Return storage capacity (total and used pallets) at a location.',
  parameters: {
    type: 'object',
    properties: { locationId: { type: 'string' } },
    required: ['locationId'],
  },
  async run({ locationId }) {
    const s = await M.StorageCapacity.findOne({ locationId }).lean();
    if (!s) return { found: false };
    return { found: true, ...s, available: (s.totalPallets || 0) - (s.usedPallets || 0) };
  },
});

defineTool({
  name: 'calculateRequiredQuantity',
  description: 'Deterministically compute the required purchase quantity for a sku/location.',
  parameters: {
    type: 'object',
    properties: { sku: { type: 'string' }, locationId: { type: 'string' } },
    required: ['sku', 'locationId'],
  },
  async run({ sku, locationId }) {
    const [inv, forecast, supplier, openPos] = await Promise.all([
      M.Inventory.findOne({ sku, locationId }).lean(),
      M.DemandForecast.findOne({ sku, locationId }).sort({ generatedAt: -1 }).lean(),
      M.Supplier.findOne({ sku }).lean(),
      M.PurchaseOrder.find({ locationId, status: { $in: ['APPROVED', 'SUBMITTED'] }, 'items.sku': sku }).lean(),
    ]);
    if (!inv || !forecast || !supplier) return { error: 'MISSING_DATA', inv: !!inv, forecast: !!forecast, supplier: !!supplier };
    const incoming = openPos.reduce((sum, po) => sum + po.items.filter((i) => i.sku === sku).reduce((s, i) => s + i.quantity, 0), 0);
    const position = purchasing.inventoryPosition({ onHand: inv.onHand, reserved: inv.reserved, incomingWithinHorizon: incoming });
    const target = purchasing.targetStock({ expectedDemand: forecast.expectedUnits, safetyStock: inv.safetyStock });
    const required = purchasing.requiredQuantity({ target, position, minOrderQty: supplier.minOrderQty, orderMultiple: supplier.orderMultiple });
    return { position, target, required, incomingWithinHorizon: incoming };
  },
});

defineTool({
  name: 'validatePurchaseOrder',
  description: 'Validate a draft PO against business rules without creating it.',
  parameters: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      locationId: { type: 'string' },
      quantity: { type: 'number' },
    },
    required: ['sku', 'locationId', 'quantity'],
  },
  async run({ sku, locationId, quantity }) {
    const ctx = await loadContext(sku, locationId);
    return purchasing.evaluate({ context: ctx, recommendedQty: quantity });
  },
});

defineTool({
  name: 'createDraftPurchaseOrder',
  description: 'Create a draft PO in state DRAFT (not submitted).',
  parameters: {
    type: 'object',
    properties: {
      sku: { type: 'string' },
      locationId: { type: 'string' },
      quantity: { type: 'number' },
      createdBy: { type: 'string' },
    },
    required: ['sku', 'locationId', 'quantity'],
  },
  async run({ sku, locationId, quantity, createdBy }) {
    const supplier = await M.Supplier.findOne({ sku }).lean();
    const product = await M.Product.findOne({ sku }).lean();
    if (!supplier || !product) throw new Error('Cannot draft PO — missing supplier or product.');
    const unitPrice = supplier.unitPrice || product.unitPrice;
    const totalCost = quantity * unitPrice;
    const poId = `PO-${uuidv4().slice(0, 8).toUpperCase()}`;
    const expectedArrival = new Date(Date.now() + (supplier.leadTimeDays || 7) * 24 * 60 * 60 * 1000);
    const po = await M.PurchaseOrder.create({
      poId, supplierId: supplier.supplierId, locationId,
      items: [{ sku, quantity, unitPrice }],
      totalCost, status: 'DRAFT', expectedArrival,
      createdBy: createdBy || 'ai-agent', isIncoming: true,
    });
    return po.toObject();
  },
});

defineTool({
  name: 'getPurchaseOrder',
  description: 'Fetch a PO by poId.',
  parameters: { type: 'object', properties: { poId: { type: 'string' } }, required: ['poId'] },
  async run({ poId }) {
    const po = await M.PurchaseOrder.findOne({ poId }).lean();
    return po || { found: false };
  },
});

defineTool({
  name: 'approvePurchaseOrder',
  description: 'Buyer explicitly approves a draft PO. Moves to PENDING_APPROVAL -> APPROVED after rechecks.',
  parameters: {
    type: 'object',
    properties: { poId: { type: 'string' }, actor: { type: 'string' } },
    required: ['poId', 'actor'],
  },
  async run({ poId, actor }) {
    const po = await M.PurchaseOrder.findOne({ poId });
    if (!po) throw new Error('PO not found');
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(po.status)) {
      throw new Error(`Cannot approve PO in state ${po.status}`);
    }
    // Re-check hard constraints against fresh data before approving.
    const item = po.items[0];
    const ctx = await loadContext(item.sku, po.locationId);
    const check = purchasing.evaluate({ context: ctx, recommendedQty: item.quantity });
    const hardFails = check.checks.filter((c) => ['budget', 'storage', 'supplier', 'data-completeness'].includes(c.name) && !c.passed);
    if (check.decision === 'REJECT' || hardFails.length > 0) {
      const reason = hardFails.length ? hardFails.map((c) => c.detail).join(' ') : check.nextAction;
      po.status = 'PENDING_APPROVAL';
      await po.save();
      await M.Approval.create({ poId, actor, action: 'APPROVE', reason: `Blocked: ${reason}` });
      throw new Error(`Pre-approval recheck failed: ${reason}`);
    }
    const updated = await M.PurchaseOrder.findOneAndUpdate(
      { poId, status: { $in: ['DRAFT', 'PENDING_APPROVAL'] } },
      { status: 'APPROVED', approvedBy: actor },
      { new: true },
    ).lean();
    if (!updated) throw new Error('PO state changed concurrently');
    await M.Approval.create({ poId, actor, action: 'APPROVE' });
    return updated;
  },
});

defineTool({
  name: 'commitPurchaseOrder',
  description: 'Commit an approved PO through the mock supplier service. Reserves budget and storage.',
  parameters: { type: 'object', properties: { poId: { type: 'string' } }, required: ['poId'] },
  async run({ poId }) {
    // Atomic APPROVED -> SUBMITTED transition: prevents double commits under concurrency.
    const po = await M.PurchaseOrder.findOneAndUpdate(
      { poId, status: 'APPROVED' },
      { status: 'SUBMITTED', committedAt: new Date() },
      { new: true },
    );
    if (!po) {
      const existing = await M.PurchaseOrder.findOne({ poId }).lean();
      throw new Error(existing ? `Cannot commit PO in state ${existing.status}` : 'PO not found');
    }

    // Reserve budget + storage.
    const item = po.items[0];
    const product = await M.Product.findOne({ sku: item.sku });
    const unitsPerPallet = Math.max(1, product?.storageUnitsPerPallet || 50);
    const palletsNeeded = Math.ceil(item.quantity / unitsPerPallet);

    await M.Budget.updateOne({ locationId: po.locationId }, { $inc: { committed: po.totalCost } });
    await M.StorageCapacity.updateOne({ locationId: po.locationId }, { $inc: { usedPallets: palletsNeeded } });
    await M.AuditEvent.create({ type: 'PO_COMMITTED', payload: { poId, totalCost: po.totalCost, palletsNeeded } });

    return po.toObject();
  },
});

async function loadContext(sku, locationId) {
  const [product, inventory, forecast, supplier, budget, storage, openPos] = await Promise.all([
    M.Product.findOne({ sku }).lean(),
    M.Inventory.findOne({ sku, locationId }).lean(),
    M.DemandForecast.findOne({ sku, locationId }).sort({ generatedAt: -1 }).lean(),
    M.Supplier.findOne({ sku }).lean(),
    M.Budget.findOne({ locationId }).lean(),
    M.StorageCapacity.findOne({ locationId }).lean(),
    M.PurchaseOrder.find({ locationId, status: { $in: ['APPROVED', 'SUBMITTED'] }, 'items.sku': sku }).lean(),
  ]);
  return { product, inventory, forecast, supplier, budget, storage, openPos };
}

module.exports = { tools, defineTool, loadContext };
