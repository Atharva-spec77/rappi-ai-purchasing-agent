# Architecture

```mermaid
flowchart LR
  subgraph UI[React + Vite buyer dashboard]
    F[Recommendation form + presets]
    D[Decision, checklist, draft PO]
    A[Approve / Reject / Commit]
    H[Run history + tool-call log]
  end

  subgraph API[Express /api]
    R[routes/index.js]
    AG[agent/agent.js]
    V[Verifier]
    E[services/purchasing.js<br/>deterministic engine]
    T[tools/index.js<br/>authorized tools]
    PV[services/validation.js]
  end

  G[(Gemini via Emergent<br/>LLM proxy)]
  DB[(MongoDB<br/>Mongoose models)]
  S[[Mock supplier service]]

  F -->|POST /agent/analyze| R --> AG
  AG <-->|tool-calling loop, read-only tools| G
  AG --> T --> DB
  AG --> V -->|fetch any skipped source| T
  AG --> E
  E -->|decision + feasible qty| AG
  AG -->|createDraftPurchaseOrder| T
  AG -->|AgentRun + toolCalls| DB
  A -->|POST /approve: recheck constraints| R
  A -->|POST /commit: atomic, idempotent| R --> S
  R --> PV --> DB
  D & H -->|GET| R
```

## Analyze sequence

```mermaid
sequenceDiagram
  participant B as Buyer (UI)
  participant API as Express
  participant LLM as Gemini
  participant T as Tools
  participant E as Rules engine
  participant DB as MongoDB

  B->>API: POST /agent/analyze {sku, locationId, 800}
  loop up to 6 turns
    API->>LLM: messages + read-only tool schemas
    LLM-->>API: tool_calls (getInventory, getDemandForecast, ...)
    API->>T: execute (whitelisted only)
    T->>DB: read
    API->>LLM: tool results
  end
  LLM-->>API: {proposedDecision, proposedQty, explanation}
  API->>T: verifier fetches any required source Gemini skipped
  API->>E: evaluate(context, 800)
  E-->>API: decision, feasible qty, 6 checks
  Note over API: if Gemini disagrees, rules win and a warning is logged.<br/>If Gemini errors, fallback explanation.
  API->>DB: draft PO (ACCEPT/MODIFY only) + AgentRun
  API-->>B: run
  B->>API: POST /purchase-orders/:id/approve
  API->>E: re-check budget/storage/supplier with fresh data
  B->>API: POST /purchase-orders/:id/commit
  API->>DB: APPROVED→SUBMITTED (atomic), reserve budget + pallets
  API->>DB: re-read PO and run validation checks
  API-->>B: {po, validation}
```

## The six checks

| Check           | Passes when                                                            |
| --------------- | ---------------------------------------------------------------------- |
| inventory       | position < target (a purchase is needed)                               |
| existing-orders | open POs don't already cover the gap                                   |
| demand          | forecast exists and is ≤ 14 days old                                   |
| supplier        | supplier available, qty ≥ MOQ, qty is a multiple of the order multiple |
| budget          | qty × unit price ≤ remaining budget                                    |
| storage         | ⌈qty / units-per-pallet⌉ ≤ free pallets                                |
