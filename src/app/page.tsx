'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Pipeline from '@/components/Pipeline';

const DynamicLiveMap = dynamic(() => import('@/components/LiveMap'), {
  ssr: false,
  loading: () => <p style={{ color: 'var(--text-secondary)' }}>Loading Map...</p>
});

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'map' | 'pipeline' | 'queue';

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
  const [view, setView] = useState<View>('map');
  const [dbLeads, setDbLeads] = useState<any[]>([]);
  const [queueLeads, setQueueLeads] = useState<any[]>([]);
  const [queueMeta, setQueueMeta] = useState<any>(null);
  const [editingNote, setEditingNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [leadsError, setLeadsError] = useState('');
  const [queueError, setQueueError] = useState('');

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

  useEffect(() => {
    setMounted(true);
    fetchLeads();
    fetchQueue();
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Leads loaded from the DB have painPoints stored as a JSON string;
  // normalise to an array before the drawer renders it.
  const selectLead = (lead: any) => {
    if (!lead) { setSelectedLead(null); return; }
    let painPoints = lead.painPoints;
    if (typeof painPoints === 'string') {
      try { painPoints = JSON.parse(painPoints); } catch { painPoints = [painPoints]; }
    }
    setSelectedLead({ ...lead, painPoints });
    setEditingNote(lead.notes ?? '');
  };

  const updateLeadStatus = async (id: string, status: string) => {
    try {
      await fetch('/api/leads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
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
        selectLead(data.lead);
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
        alert("Domain Generated & Deployed: " + data.url);
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

    let subject = `Optimizing ${selectedLead.name}`;
    let body = selectedLead.outreachEmail || "Hi, we can fix your pain points.";

    if (body.startsWith('Subject: ')) {
      const parts = body.split('\n\n');
      subject = parts[0].replace('Subject: ', '');
      body = parts.slice(1).join('\n\n');
    }

    if (selectedLead.liveWebsiteUrl) {
      body += `\n\nTo show you what I mean, I actually took the liberty of building a live, dynamic prototype of how your digital presence should actively look and function. You can view the private demo I deployed for ${selectedLead.name} right here:\n❤ ${selectedLead.liveWebsiteUrl}\n\nLet me know your thoughts!`;
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
        alert("Outreach sent successfully!");
        await markContacted(selectedLead.id);
        setSelectedLead(null);
      } else {
        alert("Failed to send: " + data.error);
      }
    } catch (err) {
      alert("Error sending email");
    } finally {
      setSendingEmail(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!mounted) {
    return <div style={{ height: '100vh', background: 'var(--bg-primary)' }} />;
  }

  return (
    <main style={{ display: 'flex', height: 'calc(100vh - 80px)', padding: '1.5rem', gap: '1.5rem', overflow: 'hidden' }} className="animate-fade-in">

      {/* Left Sidebar */}
      <div style={{ width: '400px', display: 'flex', flexDirection: 'column', gap: '1.5rem', flexShrink: 0, height: '100%' }}>

        {/* Scan Form */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: 'var(--accent)' }}>Start Sector Scan</h2>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '0.75rem' }}>Business Type</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Dentists, Plumbers, Roofers"
                value={businessType}
                onChange={e => setBusinessType(e.target.value)}
                style={{ padding: '0.75rem 1rem' }}
              />
            </div>

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '0.75rem' }}>Target City</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Austin, Texas"
                value={city}
                onChange={e => setCity(e.target.value)}
                style={{ padding: '0.75rem 1rem' }}
              />
            </div>

            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '0.75rem' }}>Your Business Offer</label>
              <textarea
                className="input-field"
                rows={3}
                placeholder="Describe what you sell."
                value={offer}
                onChange={e => setOffer(e.target.value)}
                style={{ padding: '0.75rem 1rem' }}
              ></textarea>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '0.5rem', width: '100%', opacity: isScanning ? 0.7 : 1 }}
              onClick={startScan}
              disabled={isScanning}
            >
              {isScanning ? 'Scanning Sector (Wait)...' : 'Initialise OmniScan'}
            </button>
          </form>
        </div>

        {/* Activity Console */}
        <div className="glass-panel" style={{ padding: '1.5rem', flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Activity Console</h2>
          <div className="text-secondary" style={{ fontSize: '0.8rem', overflowY: 'auto', flexGrow: 1, paddingRight: '0.5rem', color: 'var(--text-secondary)' }}>
            {logs.length > 0 ? (
              [...logs].reverse().map((log, i) => (
                <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'var(--accent)', marginRight: '5px' }}>&gt;</span> {log}
                </div>
              ))
            ) : (
              <div>Awaiting extraction coordinates...</div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="glass-panel" style={{ flexGrow: 1, padding: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>

        {/* View Switcher */}
        <div style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 1000, display: 'flex', gap: '0.5rem', background: 'rgba(5,5,17,0.85)', padding: '0.5rem', borderRadius: '12px', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {([
            { id: 'map', label: '🗺 Live OmniRadar' },
            { id: 'pipeline', label: '🧲 Pipeline' },
            { id: 'queue', label: `📋 Today's Queue${queueMeta ? ` (${queueMeta.total})` : ''}` },
          ] as { id: View; label: string }[]).map(tab => (
            <button
              key={tab.id}
              className={`btn ${view === tab.id ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.5rem 1rem' }}
              onClick={() => {
                setView(tab.id);
                if (tab.id === 'pipeline' || tab.id === 'queue') fetchLeads();
                if (tab.id === 'queue') fetchQueue();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Map View ─────────────────────────────────────────────────────── */}
        {view === 'map' && (
          <>
            <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', zIndex: 1000, background: 'rgba(5,5,17,0.85)', padding: '0.8rem 1.2rem', borderRadius: '12px', backdropFilter: 'blur(12px)', border: '1px solid rgba(139, 92, 246, 0.3)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {isScanning ? (
                  <span className="flex items-center gap-2"><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', display: 'inline-block', boxShadow: '0 0 10px var(--success)' }}></span> Processing signals...</span>
                ) : (
                  <span>Map Ready: {leads.length} Session Targets Tracked</span>
                )}
              </div>
            </div>
            <DynamicLiveMap leads={leads} onLeadSelect={selectLead} />
          </>
        )}

        {/* ── Pipeline Kanban View ──────────────────────────────────────────── */}
        {view === 'pipeline' && (
          <div style={{ padding: '5rem 1.5rem 1.5rem', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', color: '#fff' }}>
              Pipeline — {dbLeads.length} Leads
            </h2>
            {leadsError ? (
              <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
                ⚠️ Couldn't load leads: {leadsError}
                <button className="btn btn-secondary" style={{ marginLeft: '1rem', fontSize: '0.75rem', padding: '0.3rem 0.7rem' }} onClick={fetchLeads}>
                  Retry
                </button>
              </div>
            ) : (
              <div style={{ flexGrow: 1, overflow: 'hidden' }}>
                <Pipeline
                  leads={dbLeads}
                  onStatusChange={updateLeadStatus}
                  onLeadSelect={selectLead}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Today's Queue View ────────────────────────────────────────────── */}
        {view === 'queue' && (
          <div style={{ padding: '5rem 2rem 2rem', overflowY: 'auto', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.4rem', color: '#fff' }}>📋 Today's Work Queue</h2>
                {queueMeta && (
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
                    {queueMeta.followUpDue} overdue follow-ups · {queueMeta.staleContacted} stale contacts · {queueMeta.freshNew} new leads
                  </p>
                )}
              </div>
              <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => { fetchLeads(); fetchQueue(); }}>
                🔄 Refresh
              </button>
            </div>

            {queueError ? (
              <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
                ⚠️ Couldn't load the queue: {queueError}
                <button className="btn btn-secondary" style={{ marginLeft: '1rem', fontSize: '0.75rem', padding: '0.3rem 0.7rem' }} onClick={fetchQueue}>
                  Retry
                </button>
              </div>
            ) : queueLeads.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🎉</div>
                <div>Queue is clear! Run an OmniScan to find new leads.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {queueLeads.map((lead: any) => (
                  <QueueCard
                    key={lead.id}
                    lead={lead}
                    onSelect={() => selectLead(lead)}
                    onMarkContacted={() => markContacted(lead.id)}
                    onSnooze={(days) => snoozeLeadDays(lead.id, days)}
                    onMarkReplied={() => updateLeadStatus(lead.id, 'REPLIED')}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Lead Detail Drawer ────────────────────────────────────────────────── */}
      {selectedLead && (
        <div style={{
          position: 'fixed', top: 0, right: 0, width: '500px', height: '100vh',
          background: 'rgba(10, 10, 26, 0.95)', backdropFilter: 'blur(10px)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '2rem', zIndex: 1000, overflowY: 'auto',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
          animation: 'fadeInUp 0.3s ease-out'
        }}>
          <button
            onClick={() => setSelectedLead(null)}
            style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}
          >
            &times;
          </button>

          <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>{selectedLead.name}</h2>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: '15px', fontSize: '0.8rem' }}>⭐ {selectedLead.rating}</span>
            <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: '15px', fontSize: '0.8rem' }}>Website Score: {selectedLead.websiteQualityScore}/5</span>
            <span style={{
              padding: '4px 10px', borderRadius: '15px', fontSize: '0.8rem', fontWeight: 'bold',
              background: selectedLead.status === 'NEW' ? 'rgba(59,130,246,0.2)' : selectedLead.status === 'CONTACTED' ? 'rgba(139,92,246,0.2)' : 'rgba(16,185,129,0.2)',
              color: selectedLead.status === 'NEW' ? '#60a5fa' : selectedLead.status === 'CONTACTED' ? '#a78bfa' : '#34d399',
            }}>
              {selectedLead.status}
            </span>
          </div>

          {/* Contact Email field */}
          <div style={{ marginBottom: '1.5rem', background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '8px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--accent)', display: 'block', marginBottom: '6px' }}>📧 Prospect Email</label>
            <input
              type="email"
              className="input-field"
              placeholder="prospect@theirdomain.com"
              defaultValue={selectedLead.contactEmail ?? selectedLead.emails?.[0] ?? ''}
              onBlur={async (e) => {
                await fetch('/api/leads', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selectedLead.id, contactEmail: e.target.value }) });
                setSelectedLead({ ...selectedLead, contactEmail: e.target.value });
              }}
              style={{ padding: '0.6rem', width: '100%' }}
            />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '1.5rem', background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '8px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--accent)', display: 'block', marginBottom: '6px' }}>📝 Notes</label>
            <textarea
              className="input-field"
              rows={2}
              placeholder="Add context about this lead..."
              defaultValue={selectedLead.notes ?? ''}
              onChange={(e) => setEditingNote(e.target.value)}
              style={{ padding: '0.6rem', width: '100%' }}
            />
            <button
              onClick={() => saveNote(selectedLead.id)}
              disabled={savingNote}
              className="btn btn-secondary"
              style={{ marginTop: '8px', fontSize: '0.8rem', padding: '0.4rem 1rem' }}
            >
              {savingNote ? 'Saving...' : 'Save Note'}
            </button>
          </div>

          {/* Pain Points */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '8px', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--accent)', marginBottom: '10px' }}>Detected Pain Points</h3>
            <ul style={{ paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {selectedLead.painPoints?.map((pt: string, i: number) => <li key={i}>{pt}</li>)}
            </ul>
          </div>

          {/* Outreach Email */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Generated Outreach Email</h3>
            {selectedLead.outreachEmail ? (
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '8px', fontSize: '0.85rem', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                {selectedLead.outreachEmail}
              </div>
            ) : (
              <button
                className="btn btn-primary"
                onClick={generateAssets}
                disabled={generating}
                style={{ width: '100%' }}
              >
                {generating ? 'Generating (30–60s)...' : '✨ Generate Email + Landing Page'}
              </button>
            )}
          </div>

          {/* Landing Page Preview */}
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Bespoke Landing Page Preview (Code)</h3>
            <div style={{ background: 'rgba(0,0,0,0.8)', padding: '15px', borderRadius: '8px', fontSize: '0.8rem', color: '#10b981', maxHeight: '150px', overflowY: 'auto' }}>
              <code>{selectedLead.landingPageHtml || "Awaiting AI Generation..."}</code>
            </div>
          </div>

          {/* Deploy */}
          {selectedLead.liveWebsiteUrl ? (
            <div style={{ marginBottom: '1.5rem', padding: '15px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '8px' }}>
              <h3 style={{ fontSize: '1rem', color: '#10b981', marginBottom: '4px' }}>✅ Live Prototype Deployed</h3>
              <a href={selectedLead.liveWebsiteUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', wordBreak: 'break-all', fontSize: '0.9rem' }}>{selectedLead.liveWebsiteUrl}</a>
            </div>
          ) : (
            <div style={{ marginBottom: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={deploySite} disabled={deploying || !selectedLead.landingPageHtml} style={{ width: '100%', background: 'rgba(139, 92, 246, 0.2)', border: '1px solid var(--accent)' }}>
                {deploying ? 'Deploying (Wait)...' : '🌐 Deploy Live Demo Site'}
              </button>
            </div>
          )}

          {/* Send */}
          <button
            className="btn btn-primary"
            style={{ width: '100%', fontSize: '1.1rem' }}
            onClick={sendEmail}
            disabled={sendingEmail}
          >
            {sendingEmail ? "Sending..." : "🚀 Send Outreach & Prototype Link"}
          </button>
        </div>
      )}
    </main>
  );
}

// ─── Queue Card Component ─────────────────────────────────────────────────────

function QueueCard({ lead, onSelect, onMarkContacted, onSnooze, onMarkReplied }: {
  lead: any;
  onSelect: () => void;
  onMarkContacted: () => void;
  onSnooze: (days: number) => void;
  onMarkReplied: () => void;
}) {
  const statusColors: Record<string, string> = {
    NEW: '#3b82f6', CONTACTED: '#8b5cf6', FOLLOW_UP: '#f59e0b', REPLIED: '#10b981',
  };
  const color = statusColors[lead.status] ?? '#6b7280';

  const daysSince = lead.lastContactedAt
    ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86400000)
    : null;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid rgba(255,255,255,0.08)`,
      borderLeft: `3px solid ${color}`,
      borderRadius: '10px',
      padding: '1rem 1.25rem',
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      transition: 'background 0.15s',
    }}>
      {/* Info */}
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.95rem', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.name}
        </div>
        <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', display: 'flex', gap: '12px' }}>
          <span style={{ color }}>● {lead.status}</span>
          {daysSince !== null && <span>{daysSince}d since contact</span>}
          {lead.followUpAt && <span>📅 {new Date(lead.followUpAt).toLocaleDateString()}</span>}
          <span>Site: {lead.websiteQualityScore}/5</span>
        </div>
        {lead.notes && (
          <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', marginTop: '4px', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.notes}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button
          onClick={onMarkContacted}
          className="btn btn-secondary"
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'rgba(139,92,246,0.2)' }}
        >
          📤 Contacted
        </button>
        <button
          onClick={() => onSnooze(3)}
          className="btn btn-secondary"
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}
        >
          💤 +3d
        </button>
        <button
          onClick={onMarkReplied}
          className="btn btn-secondary"
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'rgba(16,185,129,0.15)' }}
        >
          💬 Replied
        </button>
        <button
          onClick={onSelect}
          className="btn btn-secondary"
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}
        >
          →
        </button>
      </div>
    </div>
  );
}
