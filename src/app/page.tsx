'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Pipeline from '@/components/Pipeline';
import { IconClock, IconCheck, IconMail, IconExternal, IconRefresh } from '@/components/Icons';

const DynamicLiveMap = dynamic(() => import('@/components/LiveMap'), {
  ssr: false,
  loading: () => <p style={{ color: 'var(--color-text-faint)' }}>Loading map...</p>
});

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'today' | 'board' | 'map' | 'numbers';

const QUEUE_GROUPS: Record<string, { title: string; primary: string; stripe: string; urgent?: boolean }> = {
  OVERDUE: { title: 'Overdue Follow-ups', primary: 'Send Follow-Up', stripe: 'var(--accent-2)', urgent: true },
  STALE: { title: 'Gone Quiet', primary: 'Nudge', stripe: 'var(--color-text-faint)' },
  FRESH: { title: 'Fresh Leads', primary: 'Review & Send', stripe: 'var(--accent)' },
};

const STATUSES = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'REPLIED', 'CLOSED', 'LOST'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonArray(value: any): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value ? [value] : []; }
  }
  return [];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [businessType, setBusinessType] = useState('');
  const [city, setCity] = useState('');
  const [offer, setOffer] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [view, setView] = useState<View>('today');
  const [dbLeads, setDbLeads] = useState<any[]>([]);
  const [queueLeads, setQueueLeads] = useState<any[]>([]);
  const [queueMeta, setQueueMeta] = useState<any>(null);
  const [editingNote, setEditingNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [leadsError, setLeadsError] = useState('');
  const [queueError, setQueueError] = useState('');
  const [editingEmail, setEditingEmail] = useState('');
  const [editingDealValue, setEditingDealValue] = useState('');
  const [overview, setOverview] = useState<any>(null);
  const [overviewError, setOverviewError] = useState('');

  // ── Data Fetching ──────────────────────────────────────────────────────────

  const fetchLeads = async () => {
    try {
      const res = await fetch('/api/leads');
      const data = await res.json();
      if (Array.isArray(data)) {
        setDbLeads(data);
        setLeadsError('');
      } else {
        setLeadsError(data?.error || 'Failed to load leads from the database.');
      }
    } catch (e) {
      setLeadsError('Failed to load leads from the database.');
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/leads/queue');
      const data = await res.json();
      if (Array.isArray(data?.queue)) {
        setQueueLeads(data.queue);
        setQueueMeta(data.meta ?? null);
        setQueueError('');
      } else {
        setQueueError(data?.error || 'Failed to load the queue from the database.');
      }
    } catch (e) {
      setQueueError('Failed to load the queue from the database.');
    }
  };

  const fetchOverview = async () => {
    try {
      const res = await fetch('/api/overview');
      const data = await res.json();
      if (data && !data.error) {
        setOverview(data);
        setOverviewError('');
      } else {
        setOverviewError(data?.error || 'Failed to load overview.');
      }
    } catch (e) {
      setOverviewError('Failed to load overview.');
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchQueue();
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Leads loaded from the DB have painPoints stored as a JSON string;
  // normalise to an array before the detail pane renders it.
  const selectLead = (lead: any) => {
    if (!lead) { setSelectedLead(null); return; }
    setSelectedLead({ ...lead, painPoints: parseJsonArray(lead.painPoints) });
    setEditingNote(lead.notes ?? '');
    setEditingEmail(lead.outreachEmail ?? '');
    setEditingDealValue(lead.dealValue != null ? String(lead.dealValue) : '');
  };

  const updateLeadStatus = async (id: string, status: string) => {
    try {
      await fetch('/api/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      setSelectedLead((prev: any) => (prev && prev.id === id ? { ...prev, status } : prev));
      await fetchLeads();
      await fetchQueue();
    } catch (e) {}
  };

  const snoozeLeadDays = async (id: string, days: number) => {
    const followUpAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await fetch('/api/leads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'FOLLOW_UP', followUpAt }),
    });
    await fetchLeads();
    await fetchQueue();
  };

  const markContacted = async (id: string) => {
    await fetch('/api/leads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'CONTACTED', lastContactedAt: new Date().toISOString() }),
    });
    await fetchLeads();
    await fetchQueue();
  };

  const markClosed = async (id: string) => {
    const dealValue = editingDealValue ? Number(editingDealValue) : null;
    const closedAt = new Date().toISOString();
    await fetch('/api/leads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'CLOSED', dealValue, closedAt }),
    });
    setSelectedLead((prev: any) => (prev ? { ...prev, status: 'CLOSED', dealValue, closedAt } : prev));
    await fetchLeads();
    await fetchQueue();
  };

  const saveNote = async (id: string) => {
    setSavingNote(true);
    try {
      await fetch('/api/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notes: editingNote }),
      });
      await fetchLeads();
    } finally {
      setSavingNote(false);
    }
  };

  // ── Scan ──────────────────────────────────────────────────────────────────

  const startScan = async () => {
    if (!businessType || !city) return;
    setIsScanning(true);
    setLogs([]);
    setLeads([]);
    setView('map');

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessType, city, offer })
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunk = decoder.decode(value);
            const events = chunk.split('\n\n').filter(Boolean);

            for (const event of events) {
              if (event.startsWith('data: ')) {
                try {
                  const data = JSON.parse(event.slice(6));
                  if (data.message === 'DONE') {
                    setLeads(data.data);
                    setIsScanning(false);
                    await fetchLeads();
                    await fetchQueue();
                  } else if (data.message === 'ERROR') {
                    setLogs(prev => [...prev, `Error: ${data.data?.error}`]);
                    setIsScanning(false);
                  } else {
                    setLogs(prev => [...prev, data.message]);
                    if (data.data && Array.isArray(data.data)) {
                      setLeads(data.data);
                    }
                  }
                } catch (e) {
                  // JSON parse error on chunk
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      setIsScanning(false);
    }
  };

  // ── Generate Outreach ─────────────────────────────────────────────────────

  const generateAssets = async () => {
    if (!selectedLead) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLead.id, offer }),
      });
      const data = await res.json();
      if (data.success && data.lead) {
        selectLead(data.lead); // also re-seeds editingEmail from the freshly generated text
        fetchLeads();
      } else {
        alert('Generation failed: ' + (data.error ?? 'unknown error'));
      }
    } catch {
      alert('Error generating outreach assets.');
    } finally {
      setGenerating(false);
    }
  };

  // ── Deploy ────────────────────────────────────────────────────────────────

  const deploySite = async () => {
    if (!selectedLead) return;
    setDeploying(true);
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLead.id })
      });
      const data = await res.json();
      if (data.success && data.url) {
        setSelectedLead({ ...selectedLead, liveWebsiteUrl: data.url });
        fetchLeads();
      } else {
        alert("Deploy failed: " + data.error);
      }
    } catch (err) {
      alert("Error deploying site.");
    } finally {
      setDeploying(false);
    }
  };

  // ── Send Email ────────────────────────────────────────────────────────────

  const sendEmail = async () => {
    if (!selectedLead) return;
    const recipient = selectedLead.contactEmail || selectedLead.emails?.[0];
    if (!recipient || !recipient.includes('@')) {
      alert("Add the prospect's email address first (Prospect Email field above).");
      return;
    }
    setSendingEmail(true);

    // Uses the edited text in the detail pane, not the raw AI output — this is
    // the approval gate: whatever's on screen when you hit Send is what goes out.
    let subject = `Optimizing ${selectedLead.name}`;
    let body = editingEmail || selectedLead.outreachEmail || "Hi, we can fix your pain points.";

    if (body.startsWith('Subject: ')) {
      const parts = body.split('\n\n');
      subject = parts[0].replace('Subject: ', '');
      body = parts.slice(1).join('\n\n');
    }

    // Persist any edits made before sending, so the record matches what was actually sent.
    if (editingEmail && editingEmail !== selectedLead.outreachEmail) {
      await fetch('/api/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedLead.id, outreachEmail: editingEmail }),
      });
    }

    if (selectedLead.liveWebsiteUrl) {
      body += `\n\nTo show you what I mean, I actually took the liberty of building a live, dynamic prototype of how your digital presence should actively look and function. You can view the private demo I deployed for ${selectedLead.name} right here:\n${selectedLead.liveWebsiteUrl}\n\nLet me know your thoughts!`;
    }

    const html = `
      <div style="font-family: sans-serif; line-height: 1.5; color: #111;">
        ${body.replace(/\n/g, '<br/>')}
      </div>
      <hr style="margin-top:20px;"/>
      <div style="background:#f1f5f9; padding:15px; border-radius:8px;">
        <p><strong>Private Preview created for ${selectedLead.name}:</strong></p>
        <p>We've generated a potential improved landing page focusing on your customer pain points.</p>
        ${selectedLead.landingPageHtml}
      </div>
    `;

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipient,
          subject,
          html,
          leadId: selectedLead.id
        })
      });
      const data = await res.json();
      if (data.success) {
        await markContacted(selectedLead.id);
      } else {
        alert("Failed to send: " + data.error);
      }
    } catch (err) {
      alert("Error sending email");
    } finally {
      setSendingEmail(false);
    }
  };

  // ── Tab switching ─────────────────────────────────────────────────────────

  const switchView = (v: View) => {
    setView(v);
    if (v === 'today') fetchQueue();
    if (v === 'board') fetchLeads();
    if (v === 'numbers') fetchOverview();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!mounted) {
    return <div style={{ height: '100vh', background: 'var(--color-bg)' }} />;
  }

  const contextStrip = `${new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} · ${city.toUpperCase() || '—'} · ${businessType.toUpperCase() || '—'}`;

  const groupedQueue: Record<string, any[]> = { OVERDUE: [], STALE: [], FRESH: [] };
  queueLeads.forEach((l: any) => { if (groupedQueue[l.queueReason]) groupedQueue[l.queueReason].push(l); });

  return (
    <main className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px)' }}>

      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 24px 12px', borderBottom: '2.5px solid var(--color-text)' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
          <span className="mono" style={{ fontSize: '10.5px', color: 'var(--color-text-muted)' }}>{contextStrip}</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', border: '1.5px solid var(--color-text)', borderRadius: 'var(--radius-md)', padding: '8px 12px', background: 'var(--color-surface)' }}>
            <input
              value={businessType}
              onChange={e => setBusinessType(e.target.value)}
              placeholder="Business type — e.g. Dentists"
              style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: '14.5px', fontFamily: 'inherit', color: 'var(--color-text)' }}
            />
            <span style={{ color: 'var(--color-text-faint)', fontSize: '13px' }}>in</span>
            <input
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="City — e.g. Austin, Texas"
              style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: '14.5px', fontFamily: 'inherit', color: 'var(--color-text)' }}
            />
          </div>
          <button className="btn btn-primary" onClick={startScan} disabled={isScanning || !businessType || !city}>
            {isScanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>
        <details style={{ marginTop: '8px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--color-text-muted)' }}>
            Your business offer {offer ? '✓ set' : '— not set'}
          </summary>
          <textarea
            className="input-field"
            rows={2}
            value={offer}
            onChange={e => setOffer(e.target.value)}
            placeholder="Describe what you sell"
            style={{ marginTop: '6px' }}
          />
        </details>
      </div>

      {/* ── Tabstrip ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'baseline', padding: '0 24px', borderBottom: '1px solid var(--color-divider)', background: 'var(--color-surface-2)' }}>
        {([
          { id: 'today', label: 'Today', count: queueMeta?.total },
          { id: 'board', label: 'Board' },
          { id: 'map', label: 'Map' },
          { id: 'numbers', label: 'Numbers' },
        ] as { id: View; label: string; count?: number }[]).map(tab => (
          <div
            key={tab.id}
            onClick={() => switchView(tab.id)}
            style={{
              fontFamily: 'var(--font-heading)', fontSize: '15px', padding: '11px 0', cursor: 'pointer',
              color: view === tab.id ? 'var(--color-text)' : 'var(--color-text-faint)',
              borderBottom: view === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            {tab.label}
            {tab.count != null && <span className="mono" style={{ fontSize: '11px' }}>{tab.count}</span>}
          </div>
        ))}
        {queueMeta && (
          <span className="mono" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '10.5px', color: 'var(--color-text-faint)' }}>
            {queueMeta.followUpDue} OVERDUE · {queueMeta.staleContacted} STALE · {queueMeta.freshNew} NEW
          </span>
        )}
      </div>

      {/* ── Work area: main pane + persistent detail pane ────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1.4, minWidth: 0, overflowY: 'auto', padding: '18px 24px 24px' }}>

          {/* ── Today (grouped queue) ──────────────────────────────────────── */}
          {view === 'today' && (
            <>
              {queueError ? (
                <ErrorBanner message={queueError} onRetry={fetchQueue} />
              ) : queueLeads.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>
                  Queue is clear! Run a scan to find new leads.
                </div>
              ) : (
                (['OVERDUE', 'STALE', 'FRESH'] as const).map(reason => {
                  const rows = groupedQueue[reason];
                  if (rows.length === 0) return null;
                  const meta = QUEUE_GROUPS[reason];
                  return (
                    <div key={reason} style={{ marginBottom: '26px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px' }}>
                        <span style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', color: meta.urgent ? 'var(--accent-2-700)' : 'var(--color-text)' }}>{meta.title}</span>
                        <span className="mono" style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{rows.length}</span>
                      </div>
                      {rows.map((lead: any) => {
                        const reasonText = parseJsonArray(lead.painPoints)[0] || parseJsonArray(lead.websiteIssues)[0] || 'Not yet analysed';
                        const selected = selectedLead?.id === lead.id;
                        return (
                          <div
                            key={lead.id}
                            onClick={() => selectLead(lead)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '14px', padding: '13px 4px',
                              borderBottom: selected ? 'none' : '1px dashed var(--color-divider-strong)',
                              background: selected ? 'var(--accent-100)' : 'var(--color-surface)',
                              margin: selected ? '0 -8px' : 0, paddingLeft: selected ? '12px' : '4px', paddingRight: selected ? '12px' : '4px',
                              borderRadius: selected ? 'var(--radius-sm)' : 0, cursor: 'pointer',
                            }}
                          >
                            <span style={{ width: '3px', alignSelf: 'stretch', borderRadius: '2px', flexShrink: 0, background: meta.stripe }}></span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: 'var(--font-heading)', fontSize: '17px', lineHeight: 1.15 }}>{lead.name}</div>
                              <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reasonText}</div>
                              <div className="mono" style={{ fontSize: '10.5px', color: 'var(--color-text-faint)', marginTop: '5px' }}>
                                ★ {lead.rating} · SITE {lead.websiteQualityScore}/5
                                {lead.followUpAt && ` · DUE ${new Date(lead.followUpAt).toLocaleDateString()}`}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                              <button className="btn btn-primary btn-sm" onClick={() => selectLead(lead)}>{meta.primary}</button>
                              <button className="icon-btn" title="Snooze 3 days" onClick={() => snoozeLeadDays(lead.id, 3)}><IconClock /></button>
                              <button className="icon-btn" title="Mark replied" onClick={() => updateLeadStatus(lead.id, 'REPLIED')}><IconCheck /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}

              {logs.length > 0 && (
                <>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--color-divider)', margin: '20px 0' }} />
                  <div className="eyebrow" style={{ marginBottom: '6px' }}>Activity</div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.8 }}>
                    {[...logs].reverse().slice(0, 6).map((log, i) => <div key={i}>{log}</div>)}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Board (Pipeline) ────────────────────────────────────────────── */}
          {view === 'board' && (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              {leadsError ? (
                <ErrorBanner message={leadsError} onRetry={fetchLeads} />
              ) : (
                <Pipeline leads={dbLeads} onStatusChange={updateLeadStatus} onLeadSelect={selectLead} />
              )}
            </div>
          )}

          {/* ── Map ─────────────────────────────────────────────────────────── */}
          {view === 'map' && (
            <div style={{ height: '100%', position: 'relative' }}>
              <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 1000, background: 'var(--color-surface)', border: '1px solid var(--color-divider-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 12px' }}>
                <span className="mono" style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  {isScanning ? 'Scanning…' : `${leads.length} session targets`}
                </span>
              </div>
              <DynamicLiveMap leads={leads} onLeadSelect={selectLead} />
            </div>
          )}

          {/* ── Numbers (Overview) ──────────────────────────────────────────── */}
          {view === 'numbers' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
                <button className="icon-btn" title="Refresh" onClick={fetchOverview}><IconRefresh /></button>
              </div>
              {overviewError ? (
                <ErrorBanner message={overviewError} onRetry={fetchOverview} />
              ) : !overview ? (
                <div style={{ color: 'var(--color-text-faint)' }}>Loading...</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '22px 18px', marginBottom: '30px' }}>
                    <NumTile label="TOTAL LEADS" value={overview.totalLeads} />
                    <NumTile label="REPLY RATE" value={overview.replyRate != null ? `${(overview.replyRate * 100).toFixed(0)}%` : '—'} />
                    <NumTile label="CLOSE RATE" value={overview.closeRate != null ? `${(overview.closeRate * 100).toFixed(0)}%` : '—'} />
                    <NumTile label="CLOSED REVENUE" value={`$${overview.totalClosedRevenue.toLocaleString()}`} plain />
                    <NumTile label="SCANS (7D)" value={overview.scansThisWeek} plain />
                    <NumTile label="EMAILS (7D)" value={overview.emailsSentThisWeek} plain />
                    <NumTile label="EMAILS (TOTAL)" value={overview.emailsSentTotal} plain />
                    <NumTile label="DEMOS DEPLOYED" value={overview.demosDeployedTotal} plain />
                    <NumTile label="CONTACTED OR BEYOND" value={overview.contactedOrBeyond} plain />
                  </div>

                  <div className="eyebrow" style={{ marginBottom: '10px' }}>Pipeline by Status</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '26px' }}>
                    {Object.entries(overview.byStatus || {}).map(([status, count]) => (
                      <span key={status} className="mono" style={{ fontSize: '11px', border: '1px solid var(--color-divider-strong)', borderRadius: 'var(--radius-sm)', padding: '4px 10px', color: 'var(--color-text-muted)' }}>
                        {status}: <strong style={{ color: 'var(--color-text)' }}>{count as number}</strong>
                      </span>
                    ))}
                  </div>

                  <div className="eyebrow" style={{ marginBottom: '10px' }}>Recent Activity</div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {(overview.recentActivity || []).length === 0 ? (
                      <div style={{ color: 'var(--color-text-faint)', fontStyle: 'italic', fontSize: '13px' }}>No activity yet.</div>
                    ) : (
                      overview.recentActivity.map((a: any) => (
                        <div key={a.id} style={{ fontSize: '13px', color: 'var(--color-text-muted)', padding: '7px 0', borderBottom: '1px dashed var(--color-divider-strong)' }}>
                          <span className="mono" style={{ color: 'var(--color-text-faint)', marginRight: '10px', fontSize: '10.5px' }}>{new Date(a.createdAt).toLocaleString()}</span>
                          {a.message}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Detail pane — persistent, updates with selection ─────────────── */}
        <aside style={{ flex: 1, minWidth: '360px', maxWidth: '420px', borderLeft: '1px solid var(--color-divider)', background: 'var(--color-surface)', overflowY: 'auto', padding: '22px 24px 32px' }}>
          {!selectedLead ? (
            <div style={{ color: 'var(--color-text-faint)', fontSize: '13px', marginTop: '40px', textAlign: 'center' }}>
              Select a lead from Today, Board, or Map to see details here.
            </div>
          ) : (
            <div key={selectedLead.id}>
              <div className="eyebrow" style={{ marginBottom: '6px' }}>{selectedLead.status}</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: '24px', lineHeight: 1.1, marginBottom: '12px' }}>{selectedLead.name}</div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '18px' }}>
                {STATUSES.map(s => (
                  <span
                    key={s}
                    className={`pill${selectedLead.status === s ? ' on' : ''}${selectedLead.status === s && s === 'FOLLOW_UP' ? ' urgent' : ''}`}
                    onClick={() => updateLeadStatus(selectedLead.id, s)}
                  >
                    {s.replace('_', ' ')}
                  </span>
                ))}
              </div>

              <div className="input-group">
                <label className="input-label">Prospect Email</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="prospect@theirdomain.com"
                  defaultValue={selectedLead.contactEmail ?? selectedLead.emails?.[0] ?? ''}
                  onBlur={async (e) => {
                    await fetch('/api/leads', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selectedLead.id, contactEmail: e.target.value }) });
                    setSelectedLead({ ...selectedLead, contactEmail: e.target.value });
                  }}
                />
              </div>

              {(selectedLead.mobileScore != null || selectedLead.desktopScore != null) && (
                <div style={{ marginBottom: '16px' }}>
                  <div className="eyebrow" style={{ marginBottom: '8px' }}>Website Test</div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <ScoreMini label="MOBILE" value={selectedLead.mobileScore} />
                    <ScoreMini label="DESKTOP" value={selectedLead.desktopScore} />
                  </div>
                  {parseJsonArray(selectedLead.websiteIssues).map((issue: string, i: number) => (
                    <div key={i} style={{ fontSize: '12.5px', color: 'var(--color-text-muted)', padding: '2px 0' }}>
                      <span style={{ color: 'var(--accent-2)' }}>— </span>{issue}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <div className="eyebrow" style={{ marginBottom: '8px' }}>Detected Pain Points</div>
                <ul style={{ paddingLeft: '18px', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                  {selectedLead.painPoints?.map((pt: string, i: number) => <li key={i}>{pt}</li>)}
                </ul>
              </div>

              <div className="input-group">
                <label className="input-label">Notes</label>
                <textarea
                  className="input-field"
                  rows={2}
                  placeholder="Add context about this lead..."
                  defaultValue={selectedLead.notes ?? ''}
                  onChange={(e) => setEditingNote(e.target.value)}
                />
                <button onClick={() => saveNote(selectedLead.id)} disabled={savingNote} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
                  {savingNote ? 'Saving...' : 'Save Note'}
                </button>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div className="eyebrow" style={{ marginBottom: '6px' }}>Outreach Email</div>
                {selectedLead.outreachEmail ? (
                  <>
                    <p style={{ fontSize: '11.5px', color: 'var(--color-text-faint)', marginBottom: '8px' }}>Read this before sending — edit anything that's wrong.</p>
                    <textarea
                      className="input-field"
                      rows={9}
                      value={editingEmail}
                      onChange={(e) => setEditingEmail(e.target.value)}
                      style={{ fontFamily: 'var(--font-body)', lineHeight: 1.6 }}
                    />
                  </>
                ) : (
                  <button className="btn btn-primary btn-block" onClick={generateAssets} disabled={generating}>
                    {generating ? 'Generating (30–60s)...' : 'Generate Email + Landing Page'}
                  </button>
                )}
              </div>

              {selectedLead.landingPageHtml && (
                <div style={{ marginBottom: '16px' }}>
                  <div className="eyebrow" style={{ marginBottom: '8px' }}>Landing Page Preview</div>
                  <iframe
                    srcDoc={selectedLead.landingPageHtml}
                    title="Landing page preview"
                    sandbox=""
                    style={{ width: '100%', height: '220px', border: '1px solid var(--color-divider-strong)', borderRadius: 'var(--radius-sm)', background: '#fff' }}
                  />
                </div>
              )}

              {selectedLead.liveWebsiteUrl ? (
                <div style={{ marginBottom: '12px', padding: '12px', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', background: 'var(--accent-100)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--accent-700)', marginBottom: '4px', fontWeight: 600 }}>Live Demo Deployed</div>
                  <a href={selectedLead.liveWebsiteUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-700)', wordBreak: 'break-all', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <IconExternal style={{ width: 13, height: 13 }} /> {selectedLead.liveWebsiteUrl}
                  </a>
                </div>
              ) : (
                <button className="btn btn-secondary btn-block" style={{ marginBottom: '8px' }} onClick={deploySite} disabled={deploying || !selectedLead.landingPageHtml}>
                  {deploying ? 'Deploying (Wait)...' : 'Deploy Live Demo Site'}
                </button>
              )}

              <button className="btn btn-primary btn-block" style={{ marginBottom: '20px' }} onClick={sendEmail} disabled={sendingEmail}>
                <IconMail style={{ width: 14, height: 14 }} /> {sendingEmail ? "Sending..." : "Send Outreach & Prototype Link"}
              </button>

              <hr style={{ border: 'none', borderTop: '1px solid var(--color-divider)', margin: '2px 0 16px' }} />

              <div className="eyebrow" style={{ marginBottom: '10px' }}>Deal & Documents</div>
              <div className="input-group">
                <label className="input-label">Deal Value (USD)</label>
                <input
                  type="number"
                  className="input-field mono"
                  placeholder="1000"
                  value={editingDealValue}
                  onChange={(e) => setEditingDealValue(e.target.value)}
                  onBlur={async () => {
                    const val = editingDealValue ? Number(editingDealValue) : null;
                    await fetch('/api/leads', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selectedLead.id, dealValue: val }) });
                  }}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Contract Link</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Paste contract/proposal link..."
                  defaultValue={selectedLead.contractUrl ?? ''}
                  onBlur={async (e) => {
                    await fetch('/api/leads', {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: selectedLead.id, contractUrl: e.target.value, contractSentAt: e.target.value ? new Date().toISOString() : null }),
                    });
                  }}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Invoice / Payment Link</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Paste Stripe/invoice link..."
                  defaultValue={selectedLead.invoiceUrl ?? ''}
                  onBlur={async (e) => {
                    await fetch('/api/leads', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selectedLead.id, invoiceUrl: e.target.value }) });
                  }}
                />
              </div>

              {selectedLead.status !== 'CLOSED' ? (
                <button className="btn btn-secondary btn-block" style={{ borderColor: 'var(--accent)', color: 'var(--accent-700)' }} onClick={() => markClosed(selectedLead.id)}>
                  <IconCheck style={{ width: 14, height: 14 }} /> Mark Closed &amp; Won
                </button>
              ) : (
                <div style={{ color: 'var(--accent-700)', fontSize: '13px', fontWeight: 600 }}>
                  Closed{selectedLead.dealValue ? ` — $${selectedLead.dealValue.toLocaleString()}` : ''}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

// ─── Small display components ─────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: '1rem', background: 'var(--accent-2-100)', border: '1px solid var(--accent-2)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-2-700)', fontSize: '13px' }}>
      Couldn't load this: {message}
      <button className="btn btn-secondary btn-sm" style={{ marginLeft: '1rem' }} onClick={onRetry}>Retry</button>
    </div>
  );
}

function NumTile({ label, value, plain }: { label: string; value: string | number; plain?: boolean }) {
  return (
    <div>
      <div className="mono" style={{ fontFamily: 'var(--font-heading)', fontSize: '30px', lineHeight: 1, color: plain ? 'var(--color-text)' : 'var(--accent)' }}>{value}</div>
      <div className="mono" style={{ fontSize: '10.5px', letterSpacing: '.05em', color: 'var(--color-text-muted)', marginTop: '6px' }}>{label}</div>
    </div>
  );
}

function ScoreMini({ label, value }: { label: string; value: number | null }) {
  const color = value == null ? 'var(--color-text-faint)' : value >= 70 ? 'var(--accent-700)' : value >= 40 ? '#B8860B' : 'var(--accent-2)';
  return (
    <div style={{ flex: 1, border: '1px solid var(--color-divider-strong)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
      <div className="mono" style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>{label}</div>
      <div className="mono" style={{ fontSize: '18px', fontWeight: 600, marginTop: '2px', color }}>{value ?? '—'}<span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>/100</span></div>
    </div>
  );
}
