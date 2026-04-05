'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const DynamicLiveMap = dynamic(() => import('@/components/LiveMap'), {
  ssr: false,
  loading: () => <p style={{ color: 'var(--text-secondary)' }}>Loading Map...</p>
});

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
  const [view, setView] = useState<'map' | 'pipeline'>('map');
  const [dbLeads, setDbLeads] = useState<any[]>([]);

  const fetchLeads = async () => {
    try {
      const res = await fetch('/api/leads');
      const data = await res.json();
      setDbLeads(data);
    } catch(e) {}
  };

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
        fetchLeads(); // update DB silently
        alert("Domain Generated & Deployed: " + data.url);
      } else {
        alert("Deploy failed: " + data.error);
      }
    } catch(err) {
      alert("Error deploying site.");
    } finally {
      setDeploying(false);
    }
  };

  const sendEmail = async () => {
    if (!selectedLead) return;
    setSendingEmail(true);
    
    // Parse subject from outreach email logic (if generated)
    let subject = `Optimizing ${selectedLead.name}`;
    let body = selectedLead.outreachEmail || "Hi, we can fix your pain points.";
    
    if (body.startsWith('Subject: ')) {
      const parts = body.split('\n\n');
      subject = parts[0].replace('Subject: ', '');
      body = parts.slice(1).join('\n\n');
    }

    if (selectedLead.liveWebsiteUrl) {
      body += `\n\nTo show you what I mean, I actually took the liberty of building a live, dynamic prototype of how your digital presence should actively look and function. You can view the private demo I deployed for ${selectedLead.name} right here:\n➤ ${selectedLead.liveWebsiteUrl}\n\nLet me know your thoughts!`;
    }

    // Format final HTML nicely
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
          to: selectedLead.emails?.[0] || 'mock@example.com',
          subject,
          html,
          leadId: selectedLead.id
        })
      });
      const data = await res.json();
      if (data.success) {
        alert("Outreach sent successfully!");
        
        try {
          await fetch('/api/leads', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selectedLead.id, status: 'EMAILED' })
          });
          fetchLeads();
        } catch(e) {}

        setSelectedLead(null);
      } else {
        alert("Failed to send: " + data.error);
      }
    } catch(err) {
      alert("Error sending email");
    } finally {
      setSendingEmail(false);
    }
  };

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
                  } else if (data.message === 'ERROR') {
                    setLogs(prev => [...prev, `Error: ${data.data?.error}`]);
                    setIsScanning(false);
                  } else {
                    setLogs(prev => [...prev, data.message]);
                    // Update leads incrementally if data has leads
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

  useEffect(() => {
    setMounted(true);
    fetchLeads();
  }, []);

  if (!mounted) {
    return <div style={{ height: '100vh', background: 'var(--bg-primary)' }} />;
  }

  return (
    <main style={{ display: 'flex', height: 'calc(100vh - 80px)', padding: '1.5rem', gap: '1.5rem', overflow: 'hidden' }} className="animate-fade-in">
      
      {/* Left Sidebar Menu */}
      <div style={{ width: '400px', display: 'flex', flexDirection: 'column', gap: '1.5rem', flexShrink: 0, height: '100%' }}>
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

      {/* Main Map Content */}
      <div className="glass-panel" style={{ flexGrow: 1, padding: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 1000, display: 'flex', gap: '0.5rem', background: 'rgba(5,5,17,0.85)', padding: '0.5rem', borderRadius: '12px', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <button className={`btn ${view === 'map' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.5rem 1rem' }} onClick={() => setView('map')}>
             Live OmniRadar
          </button>
          <button className={`btn ${view === 'pipeline' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.5rem 1rem' }} onClick={() => { setView('pipeline'); fetchLeads(); }}>
            Pipeline DB
          </button>
        </div>

        {view === 'map' ? (
          <>
            <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', zIndex: 1000, background: 'rgba(5,5,17,0.85)', padding: '0.8rem 1.2rem', borderRadius: '12px', backdropFilter: 'blur(12px)', border: '1px solid rgba(139, 92, 246, 0.3)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {isScanning ? (
                  <span className="flex items-center gap-2"><span style={{width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', display: 'inline-block', boxShadow: '0 0 10px var(--success)'}}></span> Processing signals...</span>
                ) : (
                  <span>Map Ready: {leads.length} Session Targets Tracked</span>
                )}
              </div>
            </div>
            <DynamicLiveMap leads={leads} onLeadSelect={(lead) => setSelectedLead(lead)} />
          </>
        ) : (
          <div style={{ padding: '6rem 2rem 2rem', overflowY: 'auto', height: '100%', background: 'linear-gradient(to bottom, rgba(30, 41, 59,0.3), transparent)' }}>
            <h2 style={{ fontSize: '1.8rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>Saved Leads Database</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.2)', textAlign: 'left', color: '#fff' }}>
                  <th style={{ padding: '12px' }}>Business Name</th>
                  <th style={{ padding: '12px' }}>Phone</th>
                  <th style={{ padding: '12px' }}>Rating</th>
                  <th style={{ padding: '12px' }}>Status</th>
                  <th style={{ padding: '12px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dbLeads.map((l: any) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px', color: '#fff' }}>{l.name}</td>
                    <td style={{ padding: '12px' }}>{l.phone}</td>
                    <td style={{ padding: '12px' }}>⭐ {l.rating}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ 
                        padding: '4px 10px', borderRadius: '15px', fontSize: '0.75rem', fontWeight: 'bold',
                        background: l.status === 'NEW' ? 'rgba(59,130,246,0.2)' : 'rgba(16,185,129,0.2)',
                        color: l.status === 'NEW' ? '#60a5fa' : '#34d399'
                      }}>
                        {l.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }} onClick={() => setSelectedLead(l)}>View Asset</button>
                    </td>
                  </tr>
                ))}
                {dbLeads.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>No leads saved yet. Run an OmniScan!</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
          <div style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem' }}>
            <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: '15px', fontSize: '0.8rem' }}>⭐ {selectedLead.rating}</span>
            <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: '15px', fontSize: '0.8rem' }}>Website Score: {selectedLead.websiteQualityScore}/5</span>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '8px', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--accent)', marginBottom: '10px' }}>Detected Pain Points</h3>
            <ul style={{ paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {selectedLead.painPoints?.map((pt: string, i: number) => <li key={i}>{pt}</li>)}
            </ul>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Generated Outreach Email</h3>
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '8px', fontSize: '0.85rem', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
              {selectedLead.outreachEmail || "Awaiting AI Generation..."}
            </div>
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Bespoke Landing Page Preview (Code)</h3>
            <div style={{ background: 'rgba(0,0,0,0.8)', padding: '15px', borderRadius: '8px', fontSize: '0.8rem', color: '#10b981', maxHeight: '150px', overflowY: 'auto' }}>
              <code>{selectedLead.landingPageHtml || "Awaiting AI Generation..."}</code>
            </div>
          </div>

          {selectedLead.liveWebsiteUrl ? (
            <div style={{ marginBottom: '1.5rem', padding: '15px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '8px' }}>
              <h3 style={{ fontSize: '1rem', color: '#10b981', marginBottom: '4px' }}>✅ Live Prototype Deployed</h3>
              <a href={selectedLead.liveWebsiteUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', wordBreak: 'break-all', fontSize: '0.9rem' }}>{selectedLead.liveWebsiteUrl}</a>
            </div>
          ) : (
            <div style={{ marginBottom: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={deploySite} disabled={deploying || !selectedLead.landingPageHtml} style={{ width: '100%', background: 'rgba(139, 92, 246, 0.2)', border: '1px solid var(--accent)' }}>
                {deploying ? 'Packaging & Deploying (Wait)...' : '🌐 Deploy HTML to Netlify Edge'}
              </button>
            </div>
          )}

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
