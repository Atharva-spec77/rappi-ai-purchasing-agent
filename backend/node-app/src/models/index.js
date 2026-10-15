// All Mongoose models for the AI Purchasing Agent.
// Keeping them in one file keeps the module graph small and easy to defend
// during the interview. Each schema uses human-readable IDs (slugs) in addition
// to Mongo's _id.
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ProductSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: String,
    unitPrice: { type: Number, required: true },
    storageUnitsPerPallet: { type: Number, default: 50 },
  },
  { timestamps: true },
);

const InventorySchema = new Schema({
  sku: { type: String, required: true },
  locationId: { type: String, required: true },
  onHand: { type: Number, default: 0 },
  reserved: { type: Number, default: 0 },
  safetyStock: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});
InventorySchema.index({ sku: 1, locationId: 1 }, { unique: true });

const DemandForecastSchema = new Schema({
  sku: { type: String, required: true },
  locationId: { type: String, required: true },
  horizonDays: { type: Number, required: true }, // Planning horizon
  expectedUnits: { type: Number, required: true },
  confidence: { type: Number, default: 0.8 },
  generatedAt: { type: Date, default: Date.now },
});

const SupplierSchema = new Schema({
  supplierId: { type: String, required: true, unique: true },
  name: String,
  sku: String,
  leadTimeDays: { type: Number, default: 7 },
  minOrderQty: { type: Number, default: 1 },
  orderMultiple: { type: Number, default: 1 },
  unitPrice: Number,
  available: { type: Boolean, default: true },
});

const BudgetSchema = new Schema({
  locationId: { type: String, required: true, unique: true },
  period: { type: String, required: true }, // e.g. 2026-02
  totalBudget: Number,
  committed: { type: Number, default: 0 },
});

const StorageCapacitySchema = new Schema({
  locationId: { type: String, required: true, unique: true },
  totalPallets: Number,
  usedPallets: { type: Number, default: 0 },
});

const PurchaseOrderItemSchema = new Schema(
  {
    sku: String,
    quantity: Number,
    unitPrice: Number,
  },
  { _id: false },
);

const PurchaseOrderSchema = new Schema(
  {
    poId: { type: String, required: true, unique: true },
    supplierId: String,
    locationId: String,
    items: [PurchaseOrderItemSchema],
    totalCost: Number,
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING_APPROVAL",
        "APPROVED",
        "SUBMITTED",
        "REJECTED",
        "FAILED",
      ],
      default: "DRAFT",
    },
    expectedArrival: Date,
    createdBy: String,
    approvedBy: String,
    rejectedBy: String,
    committedAt: Date,
    // When set, this PO is expected incoming inventory (for the inventory calc)
    isIncoming: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const AgentRunSchema = new Schema(
  {
    runId: { type: String, required: true, unique: true },
    input: Schema.Types.Mixed, // product, locationId, recommendedQty
    decision: {
      type: String,
      enum: ["ACCEPT", "MODIFY", "REJECT", "INVESTIGATE", "ERROR"],
    },
    recommendedQty: Number,
    evidence: Schema.Types.Mixed,
    checks: [
      new Schema(
        {
          name: String,
          passed: Boolean,
          detail: String,
          metric: Schema.Types.Mixed,
        },
        { _id: false },
      ),
    ],
    calculations: Schema.Types.Mixed,
    missingInfo: [String],
    warnings: [String],
    nextAction: String,
    llmUsed: { type: Boolean, default: false },
    llmModel: String,
    llmProposedDecision: String,
    llmProposedQty: Number,
    llmAgreed: Boolean,
    llmError: String,
    toolCalls: [
      new Schema(
        {
          name: String,
          by: String,
          args: Schema.Types.Mixed,
          result: Schema.Types.Mixed,
          error: String,
          at: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
    ],
    draftPoId: String,
    explanation: String,
  },
  { timestamps: true },
);

const ApprovalSchema = new Schema({
  poId: String,
  action: { type: String, enum: ["APPROVE", "REJECT"] },
  actor: String,
  reason: String,
  at: { type: Date, default: Date.now },
});

const ValidationSchema = new Schema({
  poId: String,
  passed: Boolean,
  checks: [
    new Schema(
      {
        name: String,
        passed: Boolean,
        expected: Schema.Types.Mixed,
        actual: Schema.Types.Mixed,
        detail: String,
      },
      { _id: false },
    ),
  ],
  at: { type: Date, default: Date.now },
});

const AuditEventSchema = new Schema({
  type: String,
  payload: Schema.Types.Mixed,
  at: { type: Date, default: Date.now },
});

const Models = {
  Product: mongoose.model("Product", ProductSchema),
  Inventory: mongoose.model("Inventory", InventorySchema),
  DemandForecast: mongoose.model("DemandForecast", DemandForecastSchema),
  Supplier: mongoose.model("Supplier", SupplierSchema),
  Budget: mongoose.model("Budget", BudgetSchema),
  StorageCapacity: mongoose.model("StorageCapacity", StorageCapacitySchema),
  PurchaseOrder: mongoose.model("PurchaseOrder", PurchaseOrderSchema),
  AgentRun: mongoose.model("AgentRun", AgentRunSchema),
  Approval: mongoose.model("Approval", ApprovalSchema),
  Validation: mongoose.model("Validation", ValidationSchema),
  AuditEvent: mongoose.model("AuditEvent", AuditEventSchema),
};

module.exports = Models;
