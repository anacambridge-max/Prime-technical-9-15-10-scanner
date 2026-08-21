'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Signal = {
  symbol: string; name: string; direction: 'BUY' | 'SELL'; level: 'PDH' | 'PDL';
  status: string; confirmationTime: string; price: number; pdh: number; pdl: number;
  volumeMultiple: number; ema20: number; reason: string;
};
type Store = { date: string; signals: Signal[]; lastScanAt?: string; scanCount: number; dataStatus: string; error?: string };

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const time = (v?: string) => v ? new Date(v).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';

export default function Home() {
  const [store, setStore] = useState<Store>({ date: '', signals: [], scanCount: 0, dataStatus: 'OK' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Waiting for scanner');

  const load = useCallback(async () => {
    const res = await fetch('/api/results', { cache: 'no-store' });
    if (res.ok) setStore(await res.json());
  }, []);

  const scan = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/scan', { cache: 'no-store' });
      const data = await res.json();
      if (data.daily) setStore(data.daily);
      setMessage(data.message ?? (data.ok ? 'Scan completed' : data.error ?? 'Scan failed'));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Scan failed');
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(() => { scan(); }, 60_000); return () => clearInterval(id); }, [load, scan]);

  const buys = useMemo(() => store.signals.filter((s) => s.direction === 'BUY').length, [store.signals]);
  const sells = useMemo(() => store.signals.filter((s) => s.direction === 'SELL').length, [store.signals]);

  return (
    <main className="shell">
      <header className="header">
        <div><div className="eyebrow">PRIME TECHNICAL</div><h1>9:15 → 10:00 CAPTURE SCANNER</h1><p>Confirmed PDH / PDL signals are captured once and retained for the entire trading day.</p></div>
        <div className="actions"><span className={`status ${store.dataStatus.toLowerCase()}`}>{store.dataStatus}</span><button onClick={scan} disabled={busy}>{busy ? 'SCANNING…' : 'REFRESH SCAN'}</button></div>
      </header>

      <section className="cards">
        <div className="card"><span>CAPTURED TODAY</span><strong>{store.signals.length}</strong></div>
        <div className="card buy"><span>BUY</span><strong>{buys}</strong></div>
        <div className="card sell"><span>SELL</span><strong>{sells}</strong></div>
        <div className="card"><span>SCAN COUNT</span><strong>{store.scanCount}</strong></div>
        <div className="card wide"><span>LAST SCAN</span><strong>{time(store.lastScanAt)}</strong></div>
      </section>

      <div className="banner"><span className="dot" /> <b>{message}</b><span> Window: 09:15–10:00 IST</span></div>

      {store.error && <div className="error">DATA ERROR: {store.error}. Existing captured signals are retained.</div>}

      <section className="panel">
        <div className="panel-head"><div><h2>DAILY CAPTURED RESULTS</h2><p>{store.date || '—'} · {store.signals.length} confirmed signal(s)</p></div><span className="retained">● RETAINED FOR DAY</span></div>
        <div className="table-wrap">
          <table><thead><tr><th>TIME</th><th>STOCK</th><th>SIDE</th><th>LEVEL</th><th>PRICE</th><th>PDH</th><th>PDL</th><th>VOL</th><th>20 EMA</th><th>REASON</th></tr></thead>
            <tbody>{store.signals.map((s) => <tr key={`${s.symbol}-${s.direction}-${s.level}`}>
              <td>{time(s.confirmationTime)}</td><td className="symbol">{s.symbol}</td><td><span className={`pill ${s.direction.toLowerCase()}`}>{s.direction}</span></td><td>{s.level}</td><td>{fmt(s.price)}</td><td>{fmt(s.pdh)}</td><td>{fmt(s.pdl)}</td><td>{s.volumeMultiple.toFixed(1)}x</td><td>{fmt(s.ema20)}</td><td className="reason">{s.reason}</td>
            </tr>)}</tbody>
          </table>
          {!store.signals.length && <div className="empty">No confirmed Prime Technical signal has been captured yet.</div>}
        </div>
      </section>
      <footer>Scanner only · No orders or trades are executed · Upstox credentials remain server-side</footer>
    </main>
  );
}
