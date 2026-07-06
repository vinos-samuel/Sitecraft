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

const COLUMNS = [
  { id: 'NEW',       label: '🆕 New',       color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  { id: 'CONTACTED', label: '📤 Contacted', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  { id: 'FOLLOW_UP', label: '🔔 Follow Up', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { id: 'REPLIED',   label: '💬 Replied',   color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  { id: 'CLOSED',    label: '✅ Closed',    color: '#6ee7b7', bg: 'rgba(110,231,183,0.08)' },
  { id: 'LOST',      label: '❌ Lost',      color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Pipeline({ leads, onStatusChange, onLeadSelect }: PipelineProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const byStatus = (status: string) => leads.filter((l) => l.status === status);

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
    <div
      style={{
        display: 'flex',
        gap: '1rem',
        overflowX: 'auto',
        height: '100%',
        paddingBottom: '0.5rem',
      }}
    >
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
              minWidth: '220px',
              flex: '1 0 220px',
              background: isOver ? col.bg : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isOver ? col.color : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '12px',
              padding: '1rem',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              overflowY: 'auto',
            }}
          >
            {/* Column Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: col.color }}>
                {col.label}
              </span>
              <span
                style={{
                  background: col.bg,
                  color: col.color,
                  borderRadius: '20px',
                  padding: '2px 8px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                {colLeads.length}
              </span>
            </div>

            {/* Cards */}
            {colLeads.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.2)',
                  fontSize: '0.8rem',
                  paddingTop: '2rem',
                  fontStyle: 'italic',
                }}
              >
                Drop leads here
              </div>
            )}

            {colLeads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                colColor={col.color}
                onDragStart={handleDragStart}
                onSelect={onLeadSelect}
              />
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
  colColor,
  onDragStart,
  onSelect,
}: {
  lead: Lead;
  colColor: string;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onSelect: (lead: Lead) => void;
}) {
  const [hovered, setHovered] = useState(false);

  const score = lead.websiteQualityScore ?? 0;
  const scoreColor = score <= 1 ? '#ef4444' : score <= 2 ? '#f59e0b' : '#10b981';

  const daysSinceContact = lead.lastContactedAt
    ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000)
    : null;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${hovered ? colColor : 'rgba(255,255,255,0.06)'}`,
        borderRadius: '10px',
        padding: '0.85rem',
        cursor: 'grab',
        transition: 'all 0.15s ease',
        userSelect: 'none',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? `0 4px 20px rgba(0,0,0,0.3)` : 'none',
      }}
    >
      {/* Name */}
      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff', marginBottom: '6px', lineHeight: 1.3 }}>
        {lead.name}
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {lead.rating && lead.rating !== 'N/A' && (
          <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>⭐ {lead.rating}</span>
        )}
        <span style={{ fontSize: '0.72rem', color: scoreColor }}>
          Site: {score}/5
        </span>
        {daysSinceContact !== null && (
          <span style={{ fontSize: '0.72rem', color: daysSinceContact > 3 ? '#f87171' : 'rgba(255,255,255,0.5)' }}>
            {daysSinceContact}d ago
          </span>
        )}
      </div>

      {/* Phone */}
      {lead.phone && lead.phone !== 'N/A' && (
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '8px' }}>
          📞 {lead.phone}
        </div>
      )}

      {/* Notes preview */}
      {lead.notes && (
        <div
          style={{
            fontSize: '0.72rem',
            color: 'rgba(255,255,255,0.4)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: '8px',
            fontStyle: 'italic',
          }}
        >
          {lead.notes}
        </div>
      )}

      {/* View button */}
      <button
        onClick={() => onSelect(lead)}
        style={{
          width: '100%',
          padding: '5px',
          background: 'transparent',
          border: `1px solid rgba(255,255,255,0.1)`,
          borderRadius: '6px',
          color: 'rgba(255,255,255,0.6)',
          fontSize: '0.75rem',
          cursor: 'pointer',
          transition: 'all 0.1s',
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLButtonElement).style.background = colColor + '30';
          (e.target as HTMLButtonElement).style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.background = 'transparent';
          (e.target as HTMLButtonElement).style.color = 'rgba(255,255,255,0.6)';
        }}
      >
        View Assets →
      </button>
    </div>
  );
}
