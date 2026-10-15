import React from 'react';

export const PRESETS = [
  { id: 'accept', label: 'Scenario 1 · Accept', sku: 'SKU-COLA-500', locationId: 'BOG-DC-01' },
  { id: 'oversized', label: 'Oversized rec.', sku: 'SKU-COLA-500', locationId: 'MDE-DC-02' },
  { id: 'budget', label: 'Budget limit', sku: 'SKU-COLA-500', locationId: 'CLO-DC-03' },
  { id: 'storage', label: 'Storage limit', sku: 'SKU-COLA-500', locationId: 'BAQ-DC-04' },
  { id: 'reject', label: 'Unnecessary', sku: 'SKU-RICE-5KG', locationId: 'MDE-DC-02' },
  { id: 'supplier', label: 'Supplier down', sku: 'SKU-OIL-1L', locationId: 'BOG-DC-01' },
  { id: 'missing', label: 'Missing data', sku: 'SKU-RICE-5KG', locationId: 'CLO-DC-03' },
];

export function ScenarioPresets({ sku, locationId, onPick }) {
  return (
    <div className="flex flex-wrap gap-2 mb-5" data-testid="scenario-presets">
      {PRESETS.map((p) => {
        const active = p.sku === sku && p.locationId === locationId;
        return (
          <button
            key={p.id}
            data-testid={`preset-${p.id}`}
            onClick={() => onPick(p)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700'}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
