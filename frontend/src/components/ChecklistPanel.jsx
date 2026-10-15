import React from 'react';
import { CheckPill } from './StatusChips';

const LABELS = {
  budget: 'Budget',
  storage: 'Storage',
  demand: 'Demand Forecast',
  supplier: 'Supplier Terms',
  inventory: 'Inventory Health',
  'existing-orders': 'Existing Orders',
};

export function ChecklistPanel({ checks }) {
  if (!checks || checks.length === 0) return null;
  return (
    <div className="card" data-testid="checklist-panel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-800">Evidence Checklist</h3>
        <span className="text-xs font-medium text-slate-500">6 constraint checks</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {checks.map((c) => (
          <div
            key={c.name}
            data-testid={`checklist-item-${c.name}`}
            className="rounded-xl border border-slate-200 p-4 bg-white hover:border-slate-300 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-800">{LABELS[c.name] || c.name}</span>
              <CheckPill passed={c.passed} />
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{c.detail}</p>
            {c.metric && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-slate-500">
                {Object.entries(c.metric).slice(0, 4).map(([k, v]) => (
                  <span key={k}><span className="text-slate-400">{k}:</span> {typeof v === 'number' ? v.toLocaleString() : String(v)}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
