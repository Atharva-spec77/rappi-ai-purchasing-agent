import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { DecisionChip, PoStatusBadge } from '@/components/StatusChips';
import { ChecklistPanel } from '@/components/ChecklistPanel';
import { ToolCallLog } from '@/components/ToolCallLog';
import { ScenarioPresets } from '@/components/ScenarioPresets';

function fmtMoney(v) { return v == null ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtNum(v) { return v == null ? '—' : Number(v).toLocaleString(); }

export default function Dashboard() {
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [pos, setPos] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [runs, setRuns] = useState([]);
  const [sku, setSku] = useState('');
  const [locationId, setLocationId] = useState('');
  const [qty, setQty] = useState(800);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressSteps, setProgressSteps] = useState([]);
  const [run, setRun] = useState(null);
  const [po, setPo] = useState(null);
  const [validation, setValidation] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const refreshLists = useCallback(async () => {
    try {
      const [p, l, o, r, inv] = await Promise.all([api.products(), api.locations(), api.purchaseOrders(), api.runs(), api.inventory()]);
      setProducts(p); setLocations(l); setPos(o); setRuns(r); setInventory(inv); setLoaded(true);
      if (!sku && p.length) setSku(p[0].sku);
      if (!locationId && l.length) setLocationId(l[0].locationId);
    } catch (e) { toast.error(`Failed to load: ${e.message}`); }
  }, [sku, locationId]);

  useEffect(() => { refreshLists(); }, [refreshLists]);

  const totalOnHand = inventory.reduce((s, i) => s + (i.onHand || 0), 0);
  const openPoCount = pos.filter((p) => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUBMITTED'].includes(p.status)).length;
  const pendingApprovals = pos.filter((p) => ['DRAFT', 'PENDING_APPROVAL'].includes(p.status)).length;
  const budgetTotal = locations.reduce((s, l) => s + (l.budget?.totalBudget || 0), 0);
  const budgetCommitted = locations.reduce((s, l) => s + (l.budget?.committed || 0), 0);
  const budgetUtil = budgetTotal > 0 ? Math.round((budgetCommitted / budgetTotal) * 100) : 0;

  async function analyze() {
    if (!sku || !locationId) return toast.error('Pick a product and location.');
    setAnalyzing(true); setRun(null); setPo(null); setValidation(null);
    const steps = [
      'Querying inventory API…',
      'Fetching demand forecast…',
      'Checking supplier terms & MOQ…',
      'Reading budget & storage…',
      'Running deterministic purchasing rules…',
      'Asking Gemini to explain the decision…',
    ];
    setProgressSteps([]);
    for (let i = 0; i < steps.length; i++) {
      setTimeout(() => setProgressSteps((p) => [...p, steps[i]]), i * 220);
    }
    try {
      const r = await api.analyze({ sku, locationId, recommendedQty: Number(qty) });
      setRun(r);
      if (r.draftPoId) {
        const pod = await api.purchaseOrder(r.draftPoId);
        setPo(pod);
      }
      toast.success(`Agent decision: ${r.decision}`);
      refreshLists();
    } catch (e) {
      toast.error(`Analyze failed: ${e.message}`);
    } finally { setAnalyzing(false); }
  }

  async function approve() {
    try { const u = await api.approve(po.poId, 'buyer-ui'); setPo(u); toast.success('PO approved'); refreshLists(); }
    catch (e) { toast.error(`Approve failed: ${e.message}`); }
  }
  async function reject() {
    try { const u = await api.reject(po.poId, 'buyer-ui', 'Rejected by buyer'); setPo(u); toast.success('PO rejected'); refreshLists(); }
    catch (e) { toast.error(`Reject failed: ${e.message}`); }
  }
  async function commit() {
    try {
      const { po: updated, validation: v } = await api.commit(po.poId);
      setPo(updated); setValidation(v);
      v.passed ? toast.success('Order committed and validated') : toast.error('Order committed BUT validation failed');
      refreshLists();
    } catch (e) { toast.error(`Commit failed: ${e.message}`); }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">R</div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Rappi AI Purchasing Agent</h1>
              <p className="text-xs text-slate-500">Buyer dashboard · Scenario 1: evaluate purchase recommendations</p>
            </div>
          </div>
          <a href="#history" className="text-sm font-medium text-blue-600 hover:text-blue-700">Run history ↓</a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-8 space-y-6">
        {/* Overview stats */}
        <section className={`grid grid-cols-2 lg:grid-cols-4 gap-4 transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}>
          <StatCard testId="overview-stat-inventory" label="Units On Hand" value={fmtNum(totalOnHand)} sub={`${products.length} SKUs · ${locations.length} DCs`} />
          <StatCard testId="overview-stat-open-pos" label="Open Purchase Orders" value={fmtNum(openPoCount)} sub="Draft → Submitted" />
          <StatCard testId="overview-stat-pending-approvals" label="Pending Approvals" value={fmtNum(pendingApprovals)} sub="Awaiting buyer sign-off" />
          <StatCard testId="overview-stat-budget" label="Budget Utilization" value={`${budgetUtil}%`} sub={`${fmtMoney(budgetCommitted)} of ${fmtMoney(budgetTotal)}`} progress={budgetUtil} />
        </section>

        {/* Recommendation form */}
        <section className="card">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">Evaluate a Purchase Recommendation</h2>
          <p className="text-sm text-slate-600 mb-4">Select a product and distribution center, then let the agent decide whether to accept, modify, reject or investigate.</p>
          <ScenarioPresets sku={sku} locationId={locationId} onPick={(p) => { setSku(p.sku); setLocationId(p.locationId); setQty(800); }} />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="stat-label mb-1 block">Product</label>
              <select className="select" value={sku} onChange={(e) => setSku(e.target.value)} data-testid="product-selector">
                {products.map((p) => <option key={p.sku} value={p.sku}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="stat-label mb-1 block">Fulfillment Location</label>
              <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)} data-testid="location-selector">
                {locations.map((l) => <option key={l.locationId} value={l.locationId}>{l.locationId}</option>)}
              </select>
            </div>
            <div>
              <label className="stat-label mb-1 block">Recommended Quantity</label>
              <input className="input font-mono" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="quantity-input" />
            </div>
            <div className="flex items-end">
              <button className="btn btn-primary w-full" disabled={analyzing} onClick={analyze} data-testid="analyze-button">
                {analyzing ? 'Analyzing…' : 'Analyze Recommendation'}
              </button>
            </div>
          </div>
          {analyzing && (
            <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <ul className="space-y-1.5 text-sm font-mono text-slate-700">
                {progressSteps.map((s, i) => (
                  <li key={i} className="fade-in">▸ {s}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Decision summary */}
        {run && (
          <section className="card fade-in" data-testid="decision-summary-card">
            <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
              <div className="min-w-[260px] flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <DecisionChip decision={run.decision} size="lg" />
                  {run.llmUsed ? (
                    <span className="pill" data-testid="ai-source-chip" style={{ background: '#EFF6FF', color: '#1E40AF' }}>GEMINI TOOL-CALLING</span>
                  ) : (
                    <span className="pill" data-testid="ai-source-chip" style={{ background: '#F1F5F9', color: '#334155' }}>RULE-BASED FALLBACK</span>
                  )}
                  {run.llmUsed && (
                    <span className="pill" data-testid="ai-verification-chip" style={run.llmAgreed ? { background: '#ECFDF5', color: '#047857' } : { background: '#FFFBEB', color: '#B45309' }}>
                      {run.llmAgreed ? 'AI MATCHES RULES' : `AI SAID ${run.llmProposedDecision} · OVERRIDDEN`}
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Agent recommends: {run.recommendedQty ?? '—'} units of {run.evidence?.product?.name || run.input?.sku}
                </h2>
                <p className="text-sm text-slate-600 mt-1">Next action: {run.nextAction}</p>
              </div>
              <div className="text-right">
                <div className="stat-label">Est. cost</div>
                <div className="text-2xl font-mono font-bold text-slate-900">{fmtMoney((run.recommendedQty || 0) * (run.calculations?.unitPrice || 0))}</div>
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700 whitespace-pre-line leading-relaxed">
              {run.explanation}
            </div>
            {run.warnings && run.warnings.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                {run.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
          </section>
        )}

        {/* Checklist */}
        {run && <ChecklistPanel checks={run.checks} />}

        {/* Draft PO */}
        {po && (
          <section className="card fade-in" data-testid="draft-po-panel">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-800 mb-1">Draft Purchase Order</h3>
                <div className="text-sm text-slate-500 font-mono">{po.poId}</div>
              </div>
              <PoStatusBadge status={po.status} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
              <KV label="SKU" value={po.items?.[0]?.sku} />
              <KV label="Quantity" value={fmtNum(po.items?.[0]?.quantity)} mono />
              <KV label="Unit Price" value={fmtMoney(po.items?.[0]?.unitPrice)} mono />
              <KV label="Total Cost" value={fmtMoney(po.totalCost)} mono />
              <KV label="Supplier" value={po.supplierId} />
              <KV label="Location" value={po.locationId} />
              <KV label="Expected Arrival" value={po.expectedArrival ? new Date(po.expectedArrival).toLocaleDateString() : '—'} />
              <KV label="Created By" value={po.createdBy} />
            </div>
            <div className="flex flex-wrap gap-2">
              {['DRAFT', 'PENDING_APPROVAL'].includes(po.status) && (
                <>
                  <button className="btn btn-success" onClick={approve} data-testid="draft-po-approve-button">Approve PO</button>
                  <button className="btn btn-danger" onClick={reject} data-testid="draft-po-reject-button">Reject</button>
                </>
              )}
              {po.status === 'APPROVED' && (
                <button className="btn btn-primary" onClick={commit} data-testid="draft-po-commit-button">Commit via Supplier</button>
              )}
              {po.status === 'SUBMITTED' && (
                <span className="text-sm text-emerald-700 font-medium">Order submitted · Lead time {po.expectedArrival ? Math.max(0, Math.ceil((new Date(po.expectedArrival) - Date.now()) / 86400000)) : '?'} days</span>
              )}
            </div>
          </section>
        )}

        {/* Validation */}
        {validation && (
          <section className="card fade-in" data-testid="post-commit-validation-panel">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800">Post-Commit Validation</h3>
              <span className="pill" style={{ background: validation.passed ? '#D1FAE5' : '#FEE2E2', color: validation.passed ? '#065F46' : '#991B1B' }}>
                {validation.passed ? 'ALL CHECKS PASSED' : 'VALIDATION FAILED'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {validation.checks.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white font-mono">
                  <span className="text-slate-700">{c.name}</span>
                  <span className={c.passed ? 'text-emerald-700' : 'text-rose-700'}>{c.passed ? '✓' : '✗'} actual={String(c.actual)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tool call log */}
        {run && <ToolCallLog toolCalls={run.toolCalls} />}

        {/* Run history */}
        <section id="history" className="card" data-testid="agent-run-history-timeline">
          <h3 className="text-base font-semibold text-slate-800 mb-4">Agent Run History</h3>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No runs yet — analyze a recommendation to populate this.</p>
          ) : (
            <div className="space-y-2">
              {runs.slice(0, 10).map((r) => (
                <div key={r.runId} className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-white">
                  <div className="flex flex-wrap items-center gap-3">
                    <DecisionChip decision={r.decision} testId={`history-chip-${r.runId}`} />
                    <code className="text-xs text-slate-700">{r.runId}</code>
                    <span className="text-xs text-slate-500">{r.input?.sku} @ {r.input?.locationId} · req {r.input?.recommendedQty} → {r.recommendedQty ?? '—'}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value, sub, progress, testId }) {
  return (
    <div className="card stat" data-testid={testId}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {progress != null && (
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

function KV({ label, value, mono }) {
  return (
    <div>
      <div className="stat-label mb-1">{label}</div>
      <div className={`text-sm text-slate-900 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</div>
    </div>
  );
}
