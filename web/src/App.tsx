import React, { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

ChartJS.defaults.color = '#9ba1a6';
ChartJS.defaults.font.family = 'Inter';

export default function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const [projection, setProjection] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);

  const fetchRuns = async () => {
    try {
      const res = await fetch('/api/runs');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const startBenchmark = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normalizeSecondRun: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start benchmark');
      }
      const data = await res.json();
      setRunId(data.runId);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!runId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/benchmark/${runId}`);
        if (!res.ok) throw new Error('Poll failed');
        const data = await res.json();
        setProjection(data);

        if (data.phase === 'COMPLETE' || data.phase === 'INVALID') {
          clearInterval(interval);
          setLoading(false);
          fetchRuns();
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [runId]);

  return (
    <div style={{ display: 'flex', maxWidth: '1400px', margin: '0 auto', gap: '32px', padding: '40px 20px' }}>
      <div style={{ width: '320px', flexShrink: 0 }}>
        <div className="glass-panel" style={{ padding: '24px', position: 'sticky', top: '40px' }}>
          <h2 style={{ margin: '0 0 20px 0', fontSize: '20px' }}>Recent Runs</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {runs.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)' }}>No runs yet.</div>
            ) : (
              runs.map((r, i) => (
                <div 
                  key={i} 
                  style={{ 
                    padding: '12px', 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: runId === r.runId ? '1px solid var(--accent)' : '1px solid transparent'
                  }}
                  onClick={() => setRunId(r.runId)}
                >
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    {new Date(r.startTime).toLocaleTimeString()}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '14px' }}>{r.runId.substring(0,8)}</span>
                    <span className={`badge ${r.phase === 'COMPLETE' ? 'measured' : ''}`}>
                      {r.phase}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      <div style={{ flex: 1, minWidth: 0 }}>
        <header className="header">
        <div>
          <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 800 }}>RadixScope</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0 0' }}>
            SGLang Cache Normalization Benchmark
          </p>
        </div>
        <button 
          className="btn" 
          onClick={startBenchmark} 
          disabled={loading}
        >
          {loading ? 'Running...' : 'Run Benchmark'}
        </button>
      </header>

      {error && (
        <div className="invalid-banner">
          ⚠️ {error}
        </div>
      )}

      {projection && projection.phase === 'INVALID' && (
        <div className="invalid-banner" style={{ background: 'rgba(255, 94, 94, 0.15)', borderLeft: '4px solid var(--danger)', padding: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '18px' }}>
              <span style={{ fontSize: '24px' }}>🚨</span> 
              <span><strong>RUN INVALIDATED</strong></span>
            </div>
            <p style={{ margin: '0 0 0 36px', color: '#ffd2d2' }}>
              {projection.verdict?.reason || 'The benchmark run violated strict execution constraints.'}
            </p>
          </div>
        </div>
      )}

      {projection && (
        <div className="glass-panel" style={{ padding: '24px', marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Run: {projection.runId}</h2>
            <div className={`badge ${projection.phase === 'COMPLETE' ? 'measured' : ''}`}>
              {projection.phase}
            </div>
          </div>
          
          <div className="grid" style={{ marginTop: '24px' }}>
            <div className="stat-card glass-panel" style={{ background: 'rgba(255,255,255,0.02)', border: 'none' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Total Records
                <span className="badge measured" style={{ marginLeft: '8px' }}>MEASURED</span>
              </div>
              <div className="stat-value">{projection.records?.length || 0}</div>
            </div>
            
            {projection.comparison && (
              <div className="stat-card glass-panel" style={{ background: 'rgba(255,255,255,0.02)', border: 'none' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Reuse Ratio Delta
                  <span className="badge derived" style={{ marginLeft: '8px' }}>DERIVED</span>
                </div>
                <div className="stat-value">
                  {(projection.comparison.reuseRatioDelta * 100).toFixed(2)}%
                </div>
              </div>
            )}
          </div>

          {projection.records && projection.records.length > 0 && (
            <div style={{ marginTop: '32px' }}>
              <Bar 
                data={{
                  labels: projection.records.map((r: any) => `${r.agent} (${r.mode})`),
                  datasets: [
                    {
                      label: 'Reuse Ratio (%)',
                      data: projection.records.map((r: any) => r.derived.reuseRatio * 100),
                      backgroundColor: projection.records.map((r: any) => r.mode === 'NORMALIZED' ? 'rgba(94, 106, 210, 0.8)' : 'rgba(255, 255, 255, 0.2)'),
                    }
                  ]
                }}
                options={{
                  responsive: true,
                  plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Cache Reuse Ratio', color: '#f0f0f5' }
                  },
                  scales: {
                    y: { beginAtZero: true, max: 100, ticks: { color: '#9ba1a6' } },
                    x: { ticks: { color: '#9ba1a6' } }
                  }
                }}
              />
            </div>
          )}
        </div>
      )}

      {projection?.records && projection.records.length > 0 && (
        <div className="glass-panel" style={{ padding: '24px', overflowX: 'auto' }}>
          <h3 style={{ marginTop: 0, marginBottom: '20px' }}>Request Telemetry</h3>
          <table>
            <thead>
              <tr>
                <th>Mode</th>
                <th>Agent</th>
                <th>Total Tokens <span className="badge sglang">SGLANG</span></th>
                <th>Cached Tokens <span className="badge sglang">SGLANG</span></th>
                <th>Latency (ms) <span className="badge measured">MEASURED</span></th>
                <th>Reuse Ratio <span className="badge derived">DERIVED</span></th>
              </tr>
            </thead>
            <tbody>
              {projection.records.map((r: any, idx: number) => (
                <tr key={idx}>
                  <td>
                    <span className="badge" style={{ background: r.mode === 'RAW' ? 'rgba(255,255,255,0.1)' : 'rgba(94,106,210,0.2)'}}>
                      {r.mode}
                    </span>
                  </td>
                  <td>{r.agent}</td>
                  <td className="metric-value">{r.native.promptTokens}</td>
                  <td className="metric-value">{r.native.cachedTokens}</td>
                  <td className="metric-value">{r.measured.totalLatencyMs?.toFixed(0)}</td>
                  <td className="metric-value">{(r.derived.reuseRatio * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
