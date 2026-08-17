'use client';

import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  name: string;
  phone: string;
  rating: string;
  websiteQualityScore: number;
  status: string;
  contactEmail?: string;
  notes?: string;
  lastContactedAt?: string;
  followUpAt?: string;
  website?: string;
}

interface PipelineProps {
  leads: Lead[];
  onStatusChange: (id: string, status: string) => Promise<void>;
  onLeadSelect: (lead: Lead) => void;
}

// ─── Config ───────────────────────────────────────────────────────────────────
// Teal = go/positive, magenta = urgent — the same two-accent discipline as the
// rest of the app. Everything else stays neutral.

const COLUMNS = [
  { id: 'NEW', label: 'New', stripe: 'var(--accent)' },
  { id: 'CONTACTED', label: 'Contacted', stripe: 'var(--color-text-faint)' },
  { id: 'FOLLOW_UP', label: 'Follow Up', stripe: 'var(--accent-2)' },
  { id: 'REPLIED', label: 'Replied', stripe: 'var(--accent)' },
  { id: 'CLOSED', label: 'Closed', stripe: 'var(--accent)' },
  { id: 'LOST', label: 'Lost', stripe: 'var(--color-text-faint)' },
];

function scoreColor(score: number): string {
  if (score <= 1) return 'var(--accent-2)';
  if (score <= 3) return '#B8860B';
  return 'var(--accent-700)';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Pipeline({ leads, onStatusChange, onLeadSelect }: PipelineProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const byStatus = (status: string) => (Array.isArray(leads) ? leads : []).filter((l) => l.status === status);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e: React.DragEvent, status: string) => {
    e.preventDefault();
    if (dragId && dragId !== status) {
      await onStatusChange(dragId, status);
    }
    setDragId(null);
    setDragOver(null);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(colId);
  };

  return (
    <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', height: '100%', paddingBottom: '0.5rem' }}>
      {COLUMNS.map((col) => {
        const colLeads = byStatus(col.id);
        const isOver = dragOver === col.id;

        return (
          <div
            key={col.id}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, col.id)}
            style={{
              minWidth: '190px',
              flex: '1 0 190px',
              background: isOver ? 'var(--accent-100)' : 'transparent',
              borderRadius: 'var(--radius-sm)',
              padding: isOver ? '8px' : 0,
              transition: 'background 0.12s',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
            }}
          >
            {/* Column Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--color-text)', paddingBottom: '6px', marginBottom: '10px' }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: '14.5px' }}>{col.label}</span>
              <span className="mono" style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{colLeads.length}</span>
            </div>

            {colLeads.length === 0 && (
              <div className="mono" style={{ textAlign: 'center', color: 'var(--color-text-faint)', fontSize: '10.5px', paddingTop: '1.5rem', fontStyle: 'italic' }}>
                drop a lead here
              </div>
            )}

            {colLeads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onDragStart={handleDragStart} onSelect={onLeadSelect} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  onDragStart,
  onSelect,
}: {
  lead: Lead;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onSelect: (lead: Lead) => void;
}) {
  const score = lead.websiteQualityScore ?? 0;
  const color = scoreColor(score);

  const daysSinceContact = lead.lastContactedAt
    ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000)
    : null;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onClick={() => onSelect(lead)}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-divider)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 11px',
        marginBottom: '8px',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      <div style={{ fontFamily: 'var(--font-heading)', fontSize: '14px', lineHeight: 1.2 }}>{lead.name}</div>

      <div className="mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '5px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {lead.rating && lead.rating !== 'N/A' && <span>★{lead.rating}</span>}
        <span>SITE {score}/5</span>
        {daysSinceContact !== null && <span>{daysSinceContact}d ago</span>}
      </div>

      {lead.notes && (
        <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontStyle: 'italic', marginTop: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.notes}
        </div>
      )}

      <div style={{ height: '3px', background: color, width: `${score * 20}%`, marginTop: '7px', borderRadius: '1px' }} />
    </div>
  );
}
