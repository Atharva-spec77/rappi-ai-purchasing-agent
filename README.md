# Rappi AI Purchasing Agent

A full-stack AI purchasing agent that helps a buyer evaluate purchase recommendations, such as buying 800 units of Cola 500ml for BOG-DC-01.

The system gathers purchasing evidence through authorized tools and produces one of four decisions: **ACCEPT, MODIFY, REJECT, or INVESTIGATE**. A deterministic purchasing rules engine validates the recommendation. Eligible recommendations can generate a draft purchase order (PO), which requires explicit buyer approval before being committed through a mock supplier service. The system then validates the persisted outcome.

**Tech Stack:** Node.js, Express, MongoDB, Mongoose, React, Vite, Tailwind CSS, Gemini tool calling, Jest, and Supertest.

---

## Core Principle: AI Orchestrates, Code Verifies

| Responsibility                                | Component                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Selecting which purchasing data to read       | Gemini through read-only tools                                          |
| Checking that required data sources were read | Backend verifier                                                        |
| Purchasing calculations and final decision    | Deterministic rules engine                                              |
| Natural-language explanation                  | Gemini when consistent with the rules; otherwise a fallback explanation |
| Creating draft purchase orders                | Backend                                                                 |
| Approving and committing purchase orders      | Explicit buyer actions through the API                                  |
| Validating committed purchase orders          | Backend validation service using MongoDB                                |

The deterministic rules engine has the final say. If Gemini proposes a different decision or quantity, the rules-based result takes priority and the discrepancy is logged.

If Gemini is unavailable, times out, or returns malformed output, the system can fall back to the rule-based workflow.

See [`docs/architecture.md`](docs/architecture.md) for the architecture diagram and analysis sequence.

---

## Purchasing Formulas

The purchasing engine evaluates the following information:

- **Inventory position:** On-hand stock minus reserved stock plus incoming stock from qualifying open purchase orders.
- **Target stock:** Forecast demand over the 30-day horizon plus safety stock.
- **Required quantity:** The quantity needed to reach target stock, adjusted for supplier MOQ and order multiples.
- **Feasible quantity:** The quantity permitted by the inventory requirement, remaining budget, and available warehouse capacity.

The engine checks six purchasing constraints:

1. **Inventory:** Is a purchase required?
2. **Existing orders:** Will incoming purchase orders already cover the stock gap?
3. **Demand:** Is a valid and sufficiently recent demand forecast available?
4. **Supplier:** Is the supplier available, and are MOQ and order-multiple requirements satisfied?
5. **Budget:** Does the order fit within the remaining budget?
6. **Storage:** Can the warehouse accommodate the required pallets?

### Decision Rules

- **REJECT:** A purchase is unnecessary because stock or existing orders already cover demand.
- **INVESTIGATE:** Required data is missing, the supplier is unavailable, the forecast is stale, or no feasible purchase quantity exists.
- **ACCEPT:** The recommendation is sufficiently close to the required quantity and satisfies all purchasing constraints.
- **MODIFY:** The proposed quantity needs adjustment to satisfy the purchasing requirements.

---

## Demo Scenarios

The dashboard provides seven presets for testing normal purchasing decisions and edge cases.

| Scenario                 | What it tests                                      | Expected result |
| ------------------------ | -------------------------------------------------- | --------------- |
| Scenario 1 — Accept      | A feasible purchase recommendation                 | ACCEPT 800      |
| Oversized Recommendation | Recommended quantity exceeds the stock requirement | MODIFY 250      |
| Budget Limit             | Remaining budget limits the purchase quantity      | MODIFY 550      |
| Storage Limit            | Warehouse capacity limits the purchase quantity    | MODIFY 300      |
| Unnecessary Purchase     | Existing stock covers the demand                   | REJECT          |
| Supplier Down            | Supplier is unavailable                            | INVESTIGATE     |
| Missing Data             | Inventory or demand data is missing                | INVESTIGATE     |

These are application demo presets. The actual result depends on the data and rules evaluated during analysis.

---

## Project Structure

```text
rappi-ai-purchasing-agent/
├── backend/
│   ├── node-app/
│   │   ├── src/
│   │   │   ├── index.js
│   │   │   ├── config/db.js
│   │   │   ├── models/index.js
│   │   │   ├── agent/agent.js
│   │   │   ├── tools/index.js
│   │   │   ├── routes/index.js
│   │   │   ├── services/purchasing.js
│   │   │   ├── services/validation.js
│   │   │   └── middleware/error.js
│   │   ├── seed/seed.js
│   │   ├── tests/
│   │   ├── package.json
│   │   └── .env.example
│   └── server.py
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/api.js
│   │   ├── pages/Dashboard.jsx
│   │   ├── App.jsx
│   │   └── index.css
│   ├── package.json
│   └── .env.example
├── docs/
│   └── architecture.md
├── .gitignore
└── README.md
```

### Important Backend Modules

- `agent/agent.js`: Runs the Gemini tool-calling workflow, verifier, and fallback handling.
- `tools/index.js`: Provides authorized tools for retrieving purchasing information and performing permitted backend operations.
- `services/purchasing.js`: Evaluates purchasing requirements and constraints.
- `services/validation.js`: Validates the persisted purchase order after commit.
- `routes/index.js`: Exposes the REST API endpoints.
- `seed/seed.js`: Loads demo data into MongoDB.
- `tests/`: Contains automated backend tests.

---

## API Endpoints

| Method | Endpoint                              | Purpose                               |
| ------ | ------------------------------------- | ------------------------------------- |
| GET    | `/api/health`                         | Backend health check                  |
| GET    | `/api/products`                       | Retrieve products                     |
| GET    | `/api/inventory`                      | Retrieve inventory information        |
| GET    | `/api/suppliers`                      | Retrieve suppliers                    |
| GET    | `/api/locations`                      | Retrieve locations                    |
| POST   | `/api/agent/analyze`                  | Analyze a purchasing recommendation   |
| GET    | `/api/agent/runs`                     | Retrieve analysis history             |
| GET    | `/api/agent/runs/:runId`              | Retrieve a specific analysis run      |
| GET    | `/api/purchase-orders`                | Retrieve purchase orders              |
| GET    | `/api/purchase-orders/:id`            | Retrieve a specific purchase order    |
| POST   | `/api/purchase-orders/:id/approve`    | Approve a draft purchase order        |
| POST   | `/api/purchase-orders/:id/reject`     | Reject a purchase order               |
| POST   | `/api/purchase-orders/:id/commit`     | Commit an approved purchase order     |
| GET    | `/api/purchase-orders/:id/validation` | Retrieve the latest validation result |

---

## Purchase Order Lifecycle

The normal purchase order workflow is:

`DRAFT → APPROVED → SUBMITTED`

The buyer must approve a draft before committing it. Rejected purchase orders transition to `REJECTED`. If approval is blocked by a constraint, the order may transition to `PENDING_APPROVAL` for further review.

After commit, the validation service checks whether:

- The purchase order was persisted.
- Its status is `SUBMITTED`.
- The SKU, quantity, supplier, unit price, and total cost match the expected values.
- The budget is not overdrawn.
- Warehouse capacity is not overbooked.

---

## Safety and Reliability

The project includes the following safeguards:

- Gemini is restricted to authorized read-only tools during analysis.
- The backend validates the AI's proposed output and uses fallback handling when needed.
- The deterministic purchasing engine controls the final decision.
- Purchase orders require explicit approval before commit.
- Approval rechecks purchasing constraints using fresh data.
- Commit uses a status guard to prevent invalid state transitions and duplicate submissions.
- Repeated commits are designed to be idempotent.
- Analysis runs and tool-call information are stored for review.
- Post-commit validation checks the persisted purchase order.

---

## Running Locally

### Prerequisites

- Node.js 20 or later
- npm
- MongoDB 6 or later running locally, or a MongoDB Atlas connection string

### 1. Start MongoDB

Ensure MongoDB is running and accessible through your configured connection URL.

### 2. Configure and Start the Backend

Open a terminal in the project root:

```powershell
cd backend/node-app
npm install
```

Create a local `.env` file by copying `.env.example`. Configure the MongoDB connection, database name, backend port, and LLM settings. Use a valid secret locally; never commit it to GitHub.

Seed the demo data:

```powershell
npm run seed
```

Start the backend:

```powershell
npm start
```

The backend listens on port `5001` by default.

Health check: `http://localhost:5001/api/health`

### 3. Configure and Start the Frontend

Open a second terminal in the project root:

```powershell
cd frontend
npm install
```

Create a local `.env` file from `.env.example` and configure:

```env
VITE_BACKEND_URL=http://localhost:5001
```

Start the frontend:

```powershell
npm start
```

Open the dashboard at `http://localhost:3000`.

### 4. Run Automated Tests

Open another terminal:

```powershell
cd backend/node-app
npm test
```

The backend test suite currently passes **33 tests across 3 test suites**. Run the command below to verify the current version of the code.

---

## Hosting Note

`backend/server.py` is a preview-environment helper. The actual purchasing logic is implemented in the Node.js backend under `backend/node-app/src`.

For a standard deployment, configure the environment variables and database connection, then run the Node.js backend directly. Follow the deployment platform's requirements for ports and process startup.

---

## Known Limitations and Future Improvements

- Purchase orders currently support a single item and a single supplier per SKU.
- Buyer authentication is not implemented; the current workflow uses a static buyer actor.
- Supplier submission uses a mock service rather than a real supplier integration.
- Real-world multi-supplier comparison, authentication, and supplier API integration can be added in future iterations.
