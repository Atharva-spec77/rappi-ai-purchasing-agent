// AI Purchasing Agent — "AI orchestrates, code verifies".
//   1. Gemini runs a tool-calling loop over READ-ONLY tools to gather evidence.
//   2. The verifier enforces that every required data source was actually read
//      (missing ones are fetched by the backend and flagged in the trace).
//   3. The deterministic engine computes the decision. If Gemini's proposed
//      decision/quantity disagrees, the deterministic result wins and a warning is logged.
//   4. If Gemini fails at any step, a rule-based fallback produces the same
//      decision with a template explanation. Write actions (draft PO) are done by
//      the backend only; approve/commit require an explicit human call.
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const M = require("../models");
const { tools, loadContext } = require("../tools");
const purchasing = require("../services/purchasing");

const LLM_TIMEOUT_MS = 30000;
const MAX_LLM_TURNS = 6;
const READ_ONLY_TOOLS = [
  "getInventory",
  "getDemandForecast",
  "getOpenPurchaseOrders",
  "getSupplierDetails",
  "getBudgetStatus",
  "getStorageCapacity",
  "calculateRequiredQuantity",
  "validatePurchaseOrder",
];
const REQUIRED_TOOLS = [
  "getInventory",
  "getDemandForecast",
  "getOpenPurchaseOrders",
  "getSupplierDetails",
  "getBudgetStatus",
  "getStorageCapacity",
];
const DECISIONS = ["ACCEPT", "MODIFY", "REJECT", "INVESTIGATE"];

const SYSTEM_PROMPT = `You are a purchasing agent for a quick-commerce company. A buyer received a purchase recommendation and asks you to evaluate it.
Use the provided tools to gather inventory, demand forecast, open purchase orders, supplier terms, budget and storage BEFORE deciding.
Never invent numbers; only use tool results. You cannot create, approve or commit orders.
Business rules: inventory position = onHand - reserved + units on APPROVED/SUBMITTED open POs. Target = forecast + safety stock. Required = target - position, rounded up to the supplier order multiple and at least the MOQ.
REJECT if required is 0. INVESTIGATE if data is missing, the supplier is unavailable, the forecast is stale, or no quantity fits the constraints (proposedQty null).
ACCEPT if the recommendation is within 10% of required and fits budget, storage (units / units-per-pallet <= free pallets), MOQ and order multiple.
Otherwise MODIFY to min(required, budget remaining / unit price, free pallets * units per pallet), rounded DOWN to the order multiple.
When done, reply with ONLY a JSON object: {"proposedDecision":"ACCEPT|MODIFY|REJECT|INVESTIGATE","proposedQty":<number or null>,"explanation":"3-5 plain sentences citing the numbers you retrieved"}`;

function argsFor(name, { sku, locationId, recommendedQty }) {
  if (["getSupplierDetails"].includes(name)) return { sku };
  if (["getBudgetStatus", "getStorageCapacity"].includes(name))
    return { locationId };
  if (name === "validatePurchaseOrder")
    return { sku, locationId, quantity: recommendedQty };
  return { sku, locationId };
}

function llmConfig() {
  const apiKey = process.env.EMERGENT_LLM_KEY;
  const base = (process.env.INTEGRATION_PROXY_URL || "").replace(/\/+$/, "");
  if (!apiKey || !base) throw new Error("LLM not configured");
  const model = process.env.LLM_MODEL || "gemini-2.5-flash";
  return {
    apiKey,
    url: `${base}/llm/chat/completions`,
    model: model.startsWith("gemini/") ? model : `gemini/${model}`,
  };
}

async function callLlm(cfg, messages, withTools) {
  const body = { model: cfg.model, messages, temperature: 0.1 };
  if (withTools) {
    body.tools = READ_ONLY_TOOLS.map((n) => ({
      type: "function",
      function: {
        name: n,
        description: tools[n].description,
        parameters: tools[n].parameters,
      },
    }));
    body.tool_choice = "auto";
  }
  const resp = await axios.post(cfg.url, body, {
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    timeout: LLM_TIMEOUT_MS,
  });
  const msg = resp?.data?.choices?.[0]?.message;
  if (!msg) throw new Error("Malformed LLM response");
  return msg;
}

function parseFinal(text) {
  const match = typeof text === "string" && text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM did not return JSON");
  const obj = JSON.parse(match[0]);
  if (!DECISIONS.includes(obj.proposedDecision))
    throw new Error(`Invalid proposedDecision: ${obj.proposedDecision}`);
  if (typeof obj.explanation !== "string" || !obj.explanation.trim())
    throw new Error("Missing explanation");
  return obj;
}

// Gemini-driven evidence gathering. Returns the parsed final answer.
async function llmLoop(input, executeTool) {
  const cfg = llmConfig();
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Recommendation: buy ${input.recommendedQty} units of ${input.sku} for location ${input.locationId}. Evaluate it.`,
    },
  ];
  for (let turn = 0; turn < MAX_LLM_TURNS; turn++) {
    const msg = await callLlm(cfg, messages, true);
    const calls = msg.tool_calls || [];
    if (calls.length === 0)
      return { ...parseFinal(msg.content), model: cfg.model };
    messages.push({
      role: "assistant",
      content: msg.content || null,
      tool_calls: calls,
    });
    for (const tc of calls) {
      const name = tc.function?.name;
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        /* keep empty */
      }
      const result = READ_ONLY_TOOLS.includes(name)
        ? await executeTool(name, args, "gemini")
        : { error: `Tool ${name} is not authorized for the agent` };
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result ?? null),
      });
    }
  }
  // Out of turns: force a final answer without tools.
  messages.push({
    role: "user",
    content: "Stop calling tools and reply with the JSON object now.",
  });
  const final = await callLlm(cfg, messages, false);
  return { ...parseFinal(final.content), model: cfg.model };
}

async function runAgent({
  sku,
  locationId,
  recommendedQty,
  createdBy = "buyer-ui",
}) {
  const runId = `RUN-${uuidv4().slice(0, 8).toUpperCase()}`;
  const input = { sku, locationId, recommendedQty };
  const toolCalls = [];
  const calledTools = new Set();

  const executeTool = async (name, args, by) => {
    try {
      const result = await tools[name].run(args);
      toolCalls.push({ name, args, result, by, at: new Date() });
      calledTools.add(name);
      return result;
    } catch (err) {
      toolCalls.push({
        name,
        args,
        error: String(err.message || err),
        by,
        at: new Date(),
      });
      return { error: String(err.message || err) };
    }
  };

  // Phase 1 — Gemini gathers evidence (or fails over).
  let llm = null;
  let llmError;
  if (process.env.AGENT_FORCE_FALLBACK !== "true") {
    try {
      llm = await llmLoop(input, executeTool);
    } catch (err) {
      llmError = String(err.message || err);
    }
  } else {
    llmError = "Fallback forced by AGENT_FORCE_FALLBACK";
  }

  // Phase 2 — verifier: make sure every required source was read.
  const warnings = [];
  for (const name of REQUIRED_TOOLS) {
    if (!calledTools.has(name)) {
      await executeTool(
        name,
        argsFor(name, input),
        llm ? "verifier" : "fallback",
      );
      if (llm)
        warnings.push(`Gemini skipped ${name}; the verifier fetched it.`);
    }
  }

  // Phase 3 — deterministic decision (source of truth).
  const context = await loadContext(sku, locationId);
  const evalResult = purchasing.evaluate({ context, recommendedQty });
  warnings.push(...evalResult.warnings);

  let llmAgreed = null;
  if (llm) {
    const qtyMatters = ["ACCEPT", "MODIFY"].includes(evalResult.decision);
    llmAgreed =
      llm.proposedDecision === evalResult.decision &&
      (!qtyMatters || Number(llm.proposedQty) === evalResult.recommendedQty);
    if (!llmAgreed) {
      warnings.push(
        `Gemini proposed ${llm.proposedDecision} ${llm.proposedQty ?? ""} — overridden by deterministic rules (${evalResult.decision} ${evalResult.recommendedQty ?? ""}).`,
      );
    }
  }
  const explanation =
    llm && llmAgreed
      ? llm.explanation
      : buildFallbackExplanation(evalResult, recommendedQty);

  // Phase 4 — draft PO (backend write, never by the LLM). Approval stays human.
  let draftPoId;
  const qty = evalResult.recommendedQty;
  if (["ACCEPT", "MODIFY"].includes(evalResult.decision) && qty > 0) {
    const draft = await executeTool(
      "createDraftPurchaseOrder",
      { sku, locationId, quantity: qty, createdBy },
      "backend",
    );
    draftPoId = draft?.poId;
  }

  const run = await M.AgentRun.create({
    runId,
    input,
    decision: evalResult.decision,
    recommendedQty: evalResult.recommendedQty,
    evidence: buildEvidence(context),
    checks: evalResult.checks,
    calculations: evalResult.calculations,
    missingInfo: evalResult.missingInfo,
    warnings,
    nextAction: evalResult.nextAction,
    llmUsed: Boolean(llm),
    llmModel: llm?.model,
    llmProposedDecision: llm?.proposedDecision,
    llmProposedQty: llm?.proposedQty,
    llmAgreed,
    llmError,
    toolCalls,
    draftPoId,
    explanation,
  });
  return run.toObject();
}

function buildEvidence(c) {
  return {
    product: c.product && {
      sku: c.product.sku,
      name: c.product.name,
      unitPrice: c.product.unitPrice,
    },
    inventory: c.inventory && {
      onHand: c.inventory.onHand,
      reserved: c.inventory.reserved,
      safetyStock: c.inventory.safetyStock,
    },
    forecast: c.forecast && {
      expectedUnits: c.forecast.expectedUnits,
      horizonDays: c.forecast.horizonDays,
      confidence: c.forecast.confidence,
    },
    supplier: c.supplier && {
      name: c.supplier.name,
      leadTimeDays: c.supplier.leadTimeDays,
      minOrderQty: c.supplier.minOrderQty,
      orderMultiple: c.supplier.orderMultiple,
      unitPrice: c.supplier.unitPrice,
      available: c.supplier.available,
    },
    budget: c.budget && {
      totalBudget: c.budget.totalBudget,
      committed: c.budget.committed,
      remaining: (c.budget.totalBudget || 0) - (c.budget.committed || 0),
    },
    storage: c.storage && {
      totalPallets: c.storage.totalPallets,
      usedPallets: c.storage.usedPallets,
      available: (c.storage.totalPallets || 0) - (c.storage.usedPallets || 0),
    },
    openPos: (c.openPos || []).map((p) => ({
      poId: p.poId,
      status: p.status,
      items: p.items,
    })),
  };
}

function buildFallbackExplanation(r, recommendedQty) {
  const c = r.calculations;
  const header = {
    ACCEPT: `ACCEPT ${recommendedQty} units.`,
    MODIFY: `MODIFY: buy ${r.recommendedQty} units instead of ${recommendedQty}.`,
    REJECT: "REJECT: this purchase is not needed.",
    INVESTIGATE: "INVESTIGATE: the agent cannot decide safely.",
  }[r.decision];
  if (r.missingInfo.length)
    return `${header} Missing data: ${r.missingInfo.join(", ")}. ${r.nextAction}`;
  const failed = r.checks.filter((ch) => !ch.passed).map((ch) => ch.detail);
  return `${header} Inventory position is ${c.position} units against a target of ${c.target} (forecast + safety stock), so ${c.required} units are required, including ${c.incomingWithinHorizon} already incoming on open POs. ${failed.length ? `Issues: ${failed.join(" ")} ` : "All budget, storage and supplier checks pass. "}${r.nextAction}`;
}

module.exports = { runAgent, parseFinal, buildFallbackExplanation };
