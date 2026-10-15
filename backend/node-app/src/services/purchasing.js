// Deterministic purchasing calculations and decision engine.
// These functions are PURE where possible so they can be tested in isolation
// without a database. They are the source of truth for all purchasing math;
// Gemini is never allowed to invent numbers — it only explains them.

const DEFAULT_HORIZON_DAYS = 30;

/**
 * Inventory Position = On-Hand - Reserved + Eligible Incoming - Open Commitments
 * Eligible incoming = SUBMITTED / APPROVED purchase orders that arrive within the
 * planning horizon. We treat `reserved` as already-committed demand so it is
 * subtracted from on-hand (never double-counted against incoming).
 */
function inventoryPosition({ onHand, reserved, incomingWithinHorizon }) {
  return (onHand || 0) - (reserved || 0) + (incomingWithinHorizon || 0);
}

/**
 * Target Stock = Forecast Demand + Safety Stock.
 */
function targetStock({ expectedDemand, safetyStock }) {
  return (expectedDemand || 0) + (safetyStock || 0);
}

/**
 * Required Additional Qty = max(0, Target - Inventory Position).
 * Rounded up to supplier order multiple and clamped to minOrderQty.
 */
function requiredQuantity({ target, position, minOrderQty = 1, orderMultiple = 1 }) {
  const raw = Math.max(0, target - position);
  if (raw === 0) return 0;
  const multiple = Math.max(1, orderMultiple);
  const rounded = Math.ceil(raw / multiple) * multiple;
  return Math.max(rounded, minOrderQty || 1);
}

/**
 * Run every check and return per-check result + aggregated decision.
 * All thresholds live here, not in the LLM.
 */
function evaluate({ context, recommendedQty }) {
  const {
    product,
    inventory,
    forecast,
    supplier,
    budget,
    storage,
    openPos,
    horizonDays = DEFAULT_HORIZON_DAYS,
  } = context;

  const missingInfo = [];
  if (!product) missingInfo.push('product');
  if (!inventory) missingInfo.push('inventory');
  if (!forecast) missingInfo.push('demandForecast');
  if (!supplier) missingInfo.push('supplier');
  if (!budget) missingInfo.push('budget');
  if (!storage) missingInfo.push('storageCapacity');

  if (missingInfo.length > 0) {
    return {
      decision: 'INVESTIGATE',
      recommendedQty: null,
      calculations: {},
      checks: [{ name: 'data-completeness', passed: false, detail: `Missing: ${missingInfo.join(', ')}` }],
      missingInfo,
      warnings: ['Essential inputs are missing — cannot evaluate the recommendation.'],
      nextAction: 'Gather missing data and re-run the agent.',
    };
  }

  const incomingWithinHorizon = (openPos || [])
    .filter((po) => po.isIncoming !== false && po.status !== 'REJECTED' && po.status !== 'FAILED')
    .reduce((sum, po) => sum + (po.items || []).filter((i) => i.sku === product.sku).reduce((s, i) => s + (i.quantity || 0), 0), 0);

  const position = inventoryPosition({
    onHand: inventory.onHand,
    reserved: inventory.reserved,
    incomingWithinHorizon,
  });
  const target = targetStock({
    expectedDemand: forecast.expectedUnits,
    safetyStock: inventory.safetyStock,
  });
  const required = requiredQuantity({
    target,
    position,
    minOrderQty: supplier.minOrderQty,
    orderMultiple: supplier.orderMultiple,
  });

  const unitPrice = supplier.unitPrice || product.unitPrice;
  const proposedCost = (recommendedQty || 0) * unitPrice;
  const requiredCost = required * unitPrice;

  // Storage: compute pallets used by proposed qty.
  const unitsPerPallet = Math.max(1, product.storageUnitsPerPallet || 50);
  const palletsProposed = Math.ceil((recommendedQty || 0) / unitsPerPallet);
  const palletsAvailable = (storage.totalPallets || 0) - (storage.usedPallets || 0);
  const palletsRequired = Math.ceil(required / unitsPerPallet);

  // Budget remaining.
  const budgetRemaining = (budget.totalBudget || 0) - (budget.committed || 0);

  const checks = [];

  // 1. Purchase necessary?
  const necessary = required > 0;
  checks.push({
    name: 'inventory',
    passed: necessary,
    detail: necessary
      ? `Inventory position (${position}) is below target (${target}). Purchase required.`
      : `Inventory position (${position}) already meets or exceeds target (${target}).`,
    metric: { position, target, onHand: inventory.onHand, reserved: inventory.reserved, incomingWithinHorizon },
  });

  // 2. Existing orders already cover demand?
  const existingCovers = incomingWithinHorizon >= Math.max(0, target - (inventory.onHand - inventory.reserved));
  checks.push({
    name: 'existing-orders',
    passed: !existingCovers,
    detail: existingCovers
      ? `Open POs deliver ${incomingWithinHorizon} units within ${horizonDays}d — demand already covered.`
      : `Open POs deliver ${incomingWithinHorizon} units within ${horizonDays}d — not enough on its own.`,
    metric: { incomingWithinHorizon, horizonDays, openPosCount: (openPos || []).length },
  });

  // 3. Demand forecast present and fresh.
  const forecastAgeDays = forecast.generatedAt
    ? Math.floor((Date.now() - new Date(forecast.generatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const forecastFresh = forecastAgeDays === null || forecastAgeDays <= 14;
  checks.push({
    name: 'demand',
    passed: forecastFresh,
    detail: forecastFresh
      ? `Forecast of ${forecast.expectedUnits}u over ${forecast.horizonDays}d (confidence ${(forecast.confidence * 100).toFixed(0)}%).`
      : `Forecast is ${forecastAgeDays} days old — may be stale.`,
    metric: { expectedUnits: forecast.expectedUnits, horizonDays: forecast.horizonDays, confidence: forecast.confidence, ageDays: forecastAgeDays },
  });

  // 4. Supplier can fulfil & MOQ satisfied.
  const supplierOk = supplier.available === true;
  const moqOk = (recommendedQty || 0) >= (supplier.minOrderQty || 1);
  const multipleOk = (recommendedQty || 0) % Math.max(1, supplier.orderMultiple || 1) === 0;
  checks.push({
    name: 'supplier',
    passed: supplierOk && moqOk && multipleOk,
    detail: !supplierOk
      ? 'Supplier marked unavailable.'
      : !moqOk
        ? `Quantity ${recommendedQty} below MOQ ${supplier.minOrderQty}.`
        : !multipleOk
          ? `Quantity ${recommendedQty} not a multiple of ${supplier.orderMultiple}.`
          : `Supplier ${supplier.name} available, lead time ${supplier.leadTimeDays}d, MOQ ${supplier.minOrderQty}.`,
    metric: { minOrderQty: supplier.minOrderQty, orderMultiple: supplier.orderMultiple, leadTimeDays: supplier.leadTimeDays, available: supplier.available },
  });

  // 5. Budget check.
  const budgetOk = proposedCost <= budgetRemaining;
  checks.push({
    name: 'budget',
    passed: budgetOk,
    detail: budgetOk
      ? `Proposed cost $${proposedCost.toFixed(2)} fits within remaining budget $${budgetRemaining.toFixed(2)}.`
      : `Proposed cost $${proposedCost.toFixed(2)} exceeds remaining budget $${budgetRemaining.toFixed(2)} by $${(proposedCost - budgetRemaining).toFixed(2)}.`,
    metric: { proposedCost, budgetRemaining, unitPrice, totalBudget: budget.totalBudget, committed: budget.committed },
  });

  // 6. Storage check.
  const storageOk = palletsProposed <= palletsAvailable;
  checks.push({
    name: 'storage',
    passed: storageOk,
    detail: storageOk
      ? `Needs ${palletsProposed} pallets, ${palletsAvailable} available.`
      : `Needs ${palletsProposed} pallets but only ${palletsAvailable} available.`,
    metric: { palletsProposed, palletsAvailable, unitsPerPallet, palletsRequired },
  });

  // Decision resolution.
  let decision;
  let nextAction;
  let finalQty = recommendedQty;
  const warnings = [];

  if (!necessary) {
    decision = 'REJECT';
    finalQty = 0;
    nextAction = 'Do NOT place this order — inventory already meets target.';
  } else if (!forecastFresh) {
    decision = 'INVESTIGATE';
    finalQty = null;
    nextAction = 'Refresh the demand forecast before deciding.';
  } else if (!supplierOk) {
    decision = 'INVESTIGATE';
    finalQty = null;
    nextAction = 'Confirm supplier availability or choose an alternate supplier.';
  } else {
    // Compute a feasible alternative that satisfies MOQ, multiples, budget and storage.
    const palletFeasible = Math.max(0, palletsAvailable) * unitsPerPallet;
    const budgetFeasible = unitPrice > 0 ? Math.floor(budgetRemaining / unitPrice) : required;
    let feasible = Math.min(required, palletFeasible, budgetFeasible);
    const mult = Math.max(1, supplier.orderMultiple || 1);
    feasible = Math.floor(feasible / mult) * mult;
    if (feasible < (supplier.minOrderQty || 0)) feasible = 0;

    const qtyMatchesRequired = recommendedQty === required;
    const quantityAppropriate = recommendedQty <= required * 1.1 && recommendedQty >= required * 0.9;

    if (budgetOk && storageOk && moqOk && multipleOk && quantityAppropriate) {
      decision = 'ACCEPT';
      finalQty = recommendedQty;
      nextAction = 'Create a draft purchase order and request buyer approval.';
      if (!qtyMatchesRequired) warnings.push(`Recommended ${recommendedQty} is within ±10% of calculated ${required}.`);
    } else if (feasible > 0) {
      decision = 'MODIFY';
      finalQty = feasible;
      nextAction = `Reduce quantity to ${feasible} units to satisfy budget/storage/MOQ constraints.`;
      if (!budgetOk) warnings.push(`Original quantity exceeds budget by $${(proposedCost - budgetRemaining).toFixed(2)}.`);
      if (!storageOk) warnings.push(`Original quantity exceeds storage by ${palletsProposed - palletsAvailable} pallets.`);
      if (!moqOk) warnings.push(`Original quantity below MOQ ${supplier.minOrderQty}.`);
      if (!multipleOk) warnings.push(`Original quantity not a multiple of ${supplier.orderMultiple}.`);
    } else {
      decision = 'INVESTIGATE';
      finalQty = null;
      nextAction = 'No feasible quantity satisfies budget, storage and MOQ at once — escalate.';
      warnings.push('No safe alternative quantity exists under current constraints.');
    }
  }

  return {
    decision,
    recommendedQty: finalQty,
    calculations: {
      position,
      target,
      required,
      incomingWithinHorizon,
      unitPrice,
      proposedCost,
      requiredCost,
      budgetRemaining,
      palletsProposed,
      palletsAvailable,
      palletsRequired,
      horizonDays,
    },
    checks,
    missingInfo,
    warnings,
    nextAction,
  };
}

module.exports = {
  DEFAULT_HORIZON_DAYS,
  inventoryPosition,
  targetStock,
  requiredQuantity,
  evaluate,
};
