const express = require("express");
const M = require("../models");
const { runAgent } = require("../agent/agent");
const { tools } = require("../tools");
const { validateCommittedOrder } = require("../services/validation");

const router = express.Router();

router.get("/health", (req, res) =>
  res.json({
    status: "ok",
    service: "rappi-purchasing-agent",
    time: new Date().toISOString(),
  }),
);

router.get("/products", async (req, res, next) => {
  try {
    res.json(await M.Product.find().lean());
  } catch (e) {
    next(e);
  }
});

router.get("/inventory", async (req, res, next) => {
  try {
    const q = {};
    if (req.query.sku) q.sku = req.query.sku;
    if (req.query.locationId) q.locationId = req.query.locationId;
    res.json(await M.Inventory.find(q).lean());
  } catch (e) {
    next(e);
  }
});

router.get("/suppliers", async (req, res, next) => {
  try {
    res.json(await M.Supplier.find().lean());
  } catch (e) {
    next(e);
  }
});

router.get("/locations", async (req, res, next) => {
  try {
    const budgets = await M.Budget.find().lean();
    const storage = await M.StorageCapacity.find().lean();
    const locationIds = Array.from(
      new Set([
        ...budgets.map((b) => b.locationId),
        ...storage.map((s) => s.locationId),
      ]),
    );
    res.json(
      locationIds.map((id) => ({
        locationId: id,
        budget: budgets.find((b) => b.locationId === id) || null,
        storage: storage.find((s) => s.locationId === id) || null,
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.get("/purchase-orders", async (req, res, next) => {
  try {
    res.json(await M.PurchaseOrder.find().sort({ createdAt: -1 }).lean());
  } catch (e) {
    next(e);
  }
});

router.get("/purchase-orders/:id", async (req, res, next) => {
  try {
    const po = await M.PurchaseOrder.findOne({ poId: req.params.id }).lean();
    if (!po) return res.status(404).json({ error: "not_found" });
    res.json(po);
  } catch (e) {
    next(e);
  }
});

router.post("/purchase-orders/:id/approve", async (req, res, next) => {
  try {
    const actor = (req.body && req.body.actor) || "buyer-ui";
    const po = await tools.approvePurchaseOrder.run({
      poId: req.params.id,
      actor,
    });
    res.json(po);
  } catch (e) {
    res.status(400).json({ error: "approve_failed", message: e.message });
  }
});

router.post("/purchase-orders/:id/reject", async (req, res, next) => {
  try {
    const po = await M.PurchaseOrder.findOne({ poId: req.params.id });
    if (!po) return res.status(404).json({ error: "not_found" });
    if (!["DRAFT", "PENDING_APPROVAL"].includes(po.status)) {
      return res.status(400).json({
        error: "invalid_state",
        message: `Cannot reject in state ${po.status}`,
      });
    }
    po.status = "REJECTED";
    po.rejectedBy = (req.body && req.body.actor) || "buyer-ui";
    await po.save();
    await M.Approval.create({
      poId: po.poId,
      action: "REJECT",
      actor: po.rejectedBy,
      reason: req.body?.reason,
    });
    res.json(po.toObject());
  } catch (e) {
    next(e);
  }
});

router.post("/purchase-orders/:id/commit", async (req, res, next) => {
  try {
    const existing = await M.PurchaseOrder.findOne({
      poId: req.params.id,
    }).lean();
    if (existing && existing.status === "SUBMITTED") {
      // Idempotent — return same + validation.
      const prior = await M.Validation.findOne({ poId: req.params.id })
        .sort({ at: -1 })
        .lean();
      return res.json({ po: existing, validation: prior, duplicate: true });
    }
    const po = await tools.commitPurchaseOrder.run({ poId: req.params.id });
    const expected = {
      sku: po.items[0].sku,
      quantity: po.items[0].quantity,
      unitPrice: po.items[0].unitPrice,
      totalCost: po.totalCost,
      supplierId: po.supplierId,
    };
    const validation = await validateCommittedOrder({
      poId: po.poId,
      expected,
    });
    res.json({ po, validation });
  } catch (e) {
    res.status(400).json({ error: "commit_failed", message: e.message });
  }
});

router.get("/purchase-orders/:id/validation", async (req, res, next) => {
  try {
    const v = await M.Validation.findOne({ poId: req.params.id })
      .sort({ at: -1 })
      .lean();
    if (!v) return res.status(404).json({ error: "not_found" });
    res.json(v);
  } catch (e) {
    next(e);
  }
});

router.post("/agent/analyze", async (req, res, next) => {
  try {
    const { sku, locationId, recommendedQty, createdBy } = req.body || {};
    if (
      !sku ||
      !locationId ||
      typeof recommendedQty !== "number" ||
      recommendedQty < 0
    ) {
      return res.status(400).json({
        error: "invalid_input",
        message: "sku, locationId and non-negative recommendedQty are required",
      });
    }
    const run = await runAgent({ sku, locationId, recommendedQty, createdBy });
    res.json(run);
  } catch (e) {
    next(e);
  }
});

router.get("/agent/runs", async (req, res, next) => {
  try {
    res.json(await M.AgentRun.find().sort({ createdAt: -1 }).limit(50).lean());
  } catch (e) {
    next(e);
  }
});

router.get("/agent/runs/:runId", async (req, res, next) => {
  try {
    const r = await M.AgentRun.findOne({ runId: req.params.runId }).lean();
    if (!r) return res.status(404).json({ error: "not_found" });
    res.json(r);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
