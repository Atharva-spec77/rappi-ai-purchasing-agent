// Integration tests against a real MongoDB (separate test database).
// The LLM is forced off so tests are deterministic and need no network.
process.env.AGENT_FORCE_FALLBACK = "true";
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../src/index");
const { seedData } = require("../seed/seed");
const M = require("../src/models");

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";

beforeAll(async () => {
  await mongoose.connect(MONGO_URL, { dbName: "rappi_agent_test" });
});

beforeEach(async () => {
  await seedData();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const analyze = (body) => request(app).post("/api/agent/analyze").send(body);

describe("agent analysis per scenario", () => {
  test.each([
    ["SKU-COLA-500", "BOG-DC-01", "ACCEPT", 800],
    ["SKU-COLA-500", "MDE-DC-02", "MODIFY", 250],
    ["SKU-COLA-500", "CLO-DC-03", "MODIFY", 550],
    ["SKU-COLA-500", "BAQ-DC-04", "MODIFY", 300],
    ["SKU-RICE-5KG", "MDE-DC-02", "REJECT", 0],
    ["SKU-OIL-1L", "BOG-DC-01", "INVESTIGATE", null],
  ])("%s @ %s -> %s %s", async (sku, locationId, decision, qty) => {
    const r = await analyze({ sku, locationId, recommendedQty: 800 });
    expect(r.status).toBe(200);
    expect(r.body.decision).toBe(decision);
    expect(r.body.recommendedQty).toBe(qty);
    expect(r.body.llmUsed).toBe(false);
    expect(Boolean(r.body.draftPoId)).toBe(
      ["ACCEPT", "MODIFY"].includes(decision),
    );
    const names = r.body.toolCalls.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "getInventory",
        "getDemandForecast",
        "getSupplierDetails",
        "getBudgetStatus",
        "getStorageCapacity",
        "getOpenPurchaseOrders",
      ]),
    );
  });

  test("missing data -> INVESTIGATE with missingInfo", async () => {
    const r = await analyze({
      sku: "SKU-RICE-5KG",
      locationId: "CLO-DC-03",
      recommendedQty: 800,
    });
    expect(r.body.decision).toBe("INVESTIGATE");
    expect(r.body.missingInfo).toEqual(
      expect.arrayContaining(["inventory", "demandForecast"]),
    );
  });

  test("invalid input -> 400", async () => {
    expect((await analyze({ sku: "SKU-COLA-500" })).status).toBe(400);
    expect(
      (
        await analyze({
          sku: "SKU-COLA-500",
          locationId: "BOG-DC-01",
          recommendedQty: -5,
        })
      ).status,
    ).toBe(400);
  });
});

describe("human approval + commit + validation", () => {
  test("full Scenario 1 cycle reserves budget/storage and validates", async () => {
    const run = await analyze({
      sku: "SKU-COLA-500",
      locationId: "BOG-DC-01",
      recommendedQty: 800,
    });
    const poId = run.body.draftPoId;

    // Commit before approval is refused.
    expect(
      (await request(app).post(`/api/purchase-orders/${poId}/commit`)).status,
    ).toBe(400);

    const approve = await request(app)
      .post(`/api/purchase-orders/${poId}/approve`)
      .send({ actor: "tester" });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("APPROVED");

    const commit = await request(app).post(
      `/api/purchase-orders/${poId}/commit`,
    );
    expect(commit.status).toBe(200);
    expect(commit.body.po.status).toBe("SUBMITTED");
    expect(commit.body.validation.passed).toBe(true);

    const budget = await M.Budget.findOne({ locationId: "BOG-DC-01" }).lean();
    expect(budget.committed).toBe(12000 + 800 * 7.1);
    const storage = await M.StorageCapacity.findOne({
      locationId: "BOG-DC-01",
    }).lean();
    expect(storage.usedPallets).toBe(140 + Math.ceil(800 / 60));

    // Idempotent: a second commit does not double-reserve budget.
    const dup = await request(app).post(`/api/purchase-orders/${poId}/commit`);
    expect(dup.body.duplicate).toBe(true);
    expect(
      (await M.Budget.findOne({ locationId: "BOG-DC-01" }).lean()).committed,
    ).toBe(budget.committed);
  });

  test("approval is blocked when budget changed after the draft", async () => {
    const run = await analyze({
      sku: "SKU-COLA-500",
      locationId: "BOG-DC-01",
      recommendedQty: 800,
    });
    await M.Budget.updateOne({ locationId: "BOG-DC-01" }, { committed: 79000 });
    const approve = await request(app)
      .post(`/api/purchase-orders/${run.body.draftPoId}/approve`)
      .send({ actor: "tester" });
    expect(approve.status).toBe(400);
    expect(approve.body.message).toMatch(/budget/i);
    const po = await M.PurchaseOrder.findOne({
      poId: run.body.draftPoId,
    }).lean();
    expect(po.status).toBe("PENDING_APPROVAL");
  });

  test("rejected PO cannot be approved or committed", async () => {
    const run = await analyze({
      sku: "SKU-COLA-500",
      locationId: "BOG-DC-01",
      recommendedQty: 800,
    });
    const poId = run.body.draftPoId;
    expect(
      (
        await request(app)
          .post(`/api/purchase-orders/${poId}/reject`)
          .send({ actor: "tester" })
      ).body.status,
    ).toBe("REJECTED");
    expect(
      (
        await request(app)
          .post(`/api/purchase-orders/${poId}/approve`)
          .send({ actor: "tester" })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post(`/api/purchase-orders/${poId}/commit`)).status,
    ).toBe(400);
  });

  test("unknown PO -> 404", async () => {
    expect(
      (await request(app).get("/api/purchase-orders/PO-NOPE")).status,
    ).toBe(404);
  });
});
