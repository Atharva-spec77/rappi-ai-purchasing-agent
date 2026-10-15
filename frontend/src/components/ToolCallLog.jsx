import React, { useState } from 'react';

export function ToolCallLog({ toolCalls }) {
  const [open, setOpen] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;
  return (
    <div className="card" data-testid="tool-call-log-viewer">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between"
        data-testid="tool-call-log-toggle"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-slate-800">Tool Call Log</h3>
          <span className="pill" style={{ background: '#EFF6FF', color: '#1E40AF' }}>{toolCalls.length}</span>
        </div>
        <span className="text-xs font-medium text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
          {toolCalls.map((t, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-1">
                <code className="text-xs font-semibold text-blue-700">{t.name}() <span className="text-slate-400 font-normal">· by {t.by || 'agent'}</span></code>
                {t.error ? (
                  <span className="pill" style={{ background: '#FEE2E2', color: '#991B1B' }}>ERROR</span>
                ) : (
                  <span className="pill" style={{ background: '#D1FAE5', color: '#065F46' }}>OK</span>
                )}
              </div>
              <div className="text-[11px] font-mono text-slate-600">
                <div><span className="text-slate-400">args:</span> {JSON.stringify(t.args)}</div>
                {t.error ? (
                  <div className="text-rose-700 mt-1">error: {t.error}</div>
                ) : (
                  <div className="text-slate-700 mt-1 line-clamp-2">result: {JSON.stringify(t.result)?.slice(0, 200)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
