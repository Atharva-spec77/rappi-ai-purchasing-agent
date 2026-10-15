const purchasing = require("../src/services/purchasing");

const futureArrival = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

const baseCtx = () => ({
  product: {
    sku: "SKU-COLA-500",
    name: "Cola",
    unitPrice: 7.5,
    storageUnitsPerPallet: 60,
  },
  inventory: { onHand: 420, reserved: 60, safetyStock: 200 },
  forecast: {
    expectedUnits: 1150,
    horizonDays: 30,
    confidence: 0.82,
    generatedAt: new Date(),
  },
  supplier: {
    name: "Andes",
    leadTimeDays: 5,
    minOrderQty: 100,
    orderMultiple: 50,
    unitPrice: 7.1,
    available: true,
  },
  budget: { totalBudget: 80000, committed: 12000 },
  storage: { totalPallets: 200, usedPallets: 140 },
  openPos: [
    {
      status: "APPROVED",
      items: [{ sku: "SKU-COLA-500", quantity: 200 }],
      isIncoming: true,
      expectedArrival: futureArrival(),
    },
  ],
});

describe("formulas", () => {
  test("inventory position = onHand - reserved + incoming", () => {
    expect(
      purchasing.inventoryPosition({
        onHand: 420,
        reserved: 60,
        incomingWithinHorizon: 200,
      }),
    ).toBe(560);
  });

  test("target = forecast + safety stock", () => {
    expect(
      purchasing.targetStock({ expectedDemand: 1150, safetyStock: 200 }),
    ).toBe(1350);
  });

  test("required quantity respects order multiple and MOQ", () => {
    expect(
      purchasing.requiredQuantity({
        target: 1000,
        position: 230,
        minOrderQty: 100,
        orderMultiple: 50,
      }),
    ).toBe(800);

    expect(
      purchasing.requiredQuantity({
        target: 1000,
        position: 960,
        minOrderQty: 100,
        orderMultiple: 50,
      }),
    ).toBe(100);

    expect(
      purchasing.requiredQuantity({
        target: 500,
        position: 900,
        minOrderQty: 100,
        orderMultiple: 50,
      }),
    ).toBe(0);
  });
});

describe("decision engine", () => {
  test("Scenario 1: ACCEPT 800 when every constraint passes", () => {
    const r = purchasing.evaluate({
      context: baseCtx(),
      recommendedQty: 800,
    });

    expect(r.decision).toBe("ACCEPT");
    expect(r.recommendedQty).toBe(800);
    expect(r.calculations).toMatchObject({
      position: 560,
      target: 1350,
      required: 800,
      proposedCost: 5680,
    });
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  test("MODIFY oversized recommendation to required quantity", () => {
    const ctx = baseCtx();
    ctx.inventory.onHand = 1000;

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.decision).toBe("MODIFY");
    expect(r.recommendedQty).toBe(250);
  });

  test("MODIFY to a budget-feasible quantity", () => {
    const ctx = baseCtx();
    ctx.budget = { totalBudget: 4000, committed: 0 };

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.decision).toBe("MODIFY");
    expect(r.recommendedQty).toBe(550);
    expect(r.recommendedQty * 7.1).toBeLessThanOrEqual(4000);
    expect(r.checks.find((c) => c.name === "budget").passed).toBe(false);
  });

  test("MODIFY to a storage-feasible quantity", () => {
    const ctx = baseCtx();
    ctx.storage = { totalPallets: 150, usedPallets: 145 };

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.decision).toBe("MODIFY");
    expect(r.recommendedQty).toBe(300);
    expect(r.checks.find((c) => c.name === "storage").passed).toBe(false);
  });

  test("REJECT when inventory already covers demand", () => {
    const ctx = baseCtx();
    ctx.inventory.onHand = 5000;

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.decision).toBe("REJECT");
    expect(r.recommendedQty).toBe(0);
  });

  test("REJECT when eligible incoming POs cover demand", () => {
    const ctx = baseCtx();
    ctx.openPos = [
      {
        status: "APPROVED",
        items: [{ sku: "SKU-COLA-500", quantity: 1200 }],
        isIncoming: true,
        expectedArrival: futureArrival(),
      },
    ];

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.decision).toBe("REJECT");
    expect(r.checks.find((c) => c.name === "existing-orders").passed).toBe(
      false,
    );
  });

  test("ignores POs arriving after the planning horizon", () => {
    const ctx = baseCtx();
    ctx.openPos[0].expectedArrival = new Date(
      Date.now() + 45 * 24 * 60 * 60 * 1000,
    );

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.calculations.incomingWithinHorizon).toBe(0);
    expect(r.calculations.position).toBe(360);
  });

  test("ignores POs whose arrival date is in the past", () => {
    const ctx = baseCtx();
    ctx.openPos[0].expectedArrival = new Date(Date.now() - 86400000);

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.calculations.incomingWithinHorizon).toBe(0);
  });

  test("ignores draft, rejected and failed POs", () => {
    const ctx = baseCtx();

    ctx.openPos = ["DRAFT", "REJECTED", "FAILED"].map((status) => ({
      status,
      items: [{ sku: "SKU-COLA-500", quantity: 200 }],
      isIncoming: true,
      expectedArrival: futureArrival(),
    }));

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.calculations.incomingWithinHorizon).toBe(0);
  });

  test("ignores POs with missing or invalid arrival dates", () => {
    const ctx = baseCtx();

    ctx.openPos = [
      {
        status: "APPROVED",
        items: [{ sku: "SKU-COLA-500", quantity: 200 }],
        isIncoming: true,
      },
      {
        status: "SUBMITTED",
        items: [{ sku: "SKU-COLA-500", quantity: 200 }],
        isIncoming: true,
        expectedArrival: "not-a-date",
      },
    ];

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.calculations.incomingWithinHorizon).toBe(0);
  });

  test("INVESTIGATE when supplier is unavailable", () => {
    const ctx = baseCtx();
    ctx.supplier.available = false;

    expect(
      purchasing.evaluate({ context: ctx, recommendedQty: 800 }).decision,
    ).toBe("INVESTIGATE");
  });

  test("INVESTIGATE when critical data is missing", () => {
    const ctx = baseCtx();
    ctx.forecast = null;

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.decision).toBe("INVESTIGATE");
    expect(r.missingInfo).toContain("demandForecast");
  });

  test("INVESTIGATE when forecast is stale", () => {
    const ctx = baseCtx();
    ctx.forecast.generatedAt = new Date(Date.now() - 30 * 86400000);

    expect(
      purchasing.evaluate({ context: ctx, recommendedQty: 800 }).decision,
    ).toBe("INVESTIGATE");
  });

  test("INVESTIGATE when no feasible quantity exists", () => {
    const ctx = baseCtx();
    ctx.budget = { totalBudget: 100, committed: 100 };

    const r = purchasing.evaluate({ context: ctx, recommendedQty: 800 });

    expect(r.decision).toBe("INVESTIGATE");
    expect(r.recommendedQty).toBeNull();
  });
});
