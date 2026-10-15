import React from 'react';

const STATUS = {
  ACCEPT:      { bg: '#ECFDF5', border: '#A7F3D0', text: '#047857', dot: '#10B981', label: 'ACCEPT' },
  MODIFY:      { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309', dot: '#F59E0B', label: 'MODIFY' },
  REJECT:      { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C', dot: '#EF4444', label: 'REJECT' },
  INVESTIGATE: { bg: '#F5F3FF', border: '#DDD6FE', text: '#6D28D9', dot: '#8B5CF6', label: 'INVESTIGATE' },
  ERROR:       { bg: '#F1F5F9', border: '#CBD5E1', text: '#334155', dot: '#64748B', label: 'ERROR' },
};

export function DecisionChip({ decision, size = 'md', testId }) {
  const s = STATUS[decision] || STATUS.INVESTIGATE;
  const padding = size === 'lg' ? '6px 14px' : '3px 10px';
  const fontSize = size === 'lg' ? 13 : 11;
  return (
    <span
      className="pill"
      data-testid={testId || 'decision-status-chip'}
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text, padding, fontSize }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: s.dot }} />
      {s.label}
    </span>
  );
}

export function PoStatusBadge({ status, testId }) {
  const map = {
    DRAFT:            { bg: '#F1F5F9', text: '#334155' },
    PENDING_APPROVAL: { bg: '#FEF3C7', text: '#92400E' },
    APPROVED:         { bg: '#DBEAFE', text: '#1E40AF' },
    SUBMITTED:        { bg: '#D1FAE5', text: '#065F46' },
    REJECTED:         { bg: '#FEE2E2', text: '#991B1B' },
    FAILED:           { bg: '#FEE2E2', text: '#991B1B' },
  };
  const s = map[status] || map.DRAFT;
  return <span className="pill" data-testid={testId || 'po-status-badge'} style={{ background: s.bg, color: s.text }}>{status}</span>;
}

export function CheckPill({ passed }) {
  return (
    <span className="pill" style={{ background: passed ? '#ECFDF5' : '#FEF2F2', color: passed ? '#047857' : '#B91C1C', border: `1px solid ${passed ? '#A7F3D0' : '#FECACA'}` }}>
      {passed ? 'PASS' : 'FAIL'}
    </span>
  );
}
