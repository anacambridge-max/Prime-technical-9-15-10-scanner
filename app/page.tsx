'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Signal = { symbol: string; name: string; direction: 'BUY' | 'SELL'; level: 'PDH' | 'PDL'; status: string; firstSeenAt?: string; confirmationTime: string; price: number; pdh: number; pdl: number; volumeMultiple: number; ema20: number; reason: string };
type ScannedStock = { symbol: string; name: string; firstScannedAt: string };
type Store = { date: string; signals: Signal[]; scannedStocks: ScannedStock[]; lastScanAt?: string; scanCount: number; dataStatus: string; error?: string; historicalBatches?: number[]; historicalBackfillDone?: boolean };

const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const time = (v?: string) => v ? new Date(v).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';

function istMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
}

export default function Home() {
  const [store, setStore] = useState<Store>({ date: '', signals: [], scannedStocks: [], scanCount: 0, dataStatus: 'OK', historicalBatches: [], historicalBackfillDone: false });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('Waiting for scanner');

  const load = useCallback(async () => {
    const res = await fetch('/api/results', { cache: 'no-store' });
    if (res.ok) setStore(await res.json());
  }, []);

  const scan = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const minutes = istMinutesNow();

      if (minutes < 555) {
        await load();
        setMessage('Scanner starts at 09:15 AM IST.');
        return;
      }

      if (minutes >= 600) {
        await load();
        setMessage("09:15–10:00 scan is closed. Today's F&O scanned and captured stocks are retained for the day.");
        return;
      }

      // One live F&O batch is scanned every 60 seconds. The API rotates through
      // the F&O universe so stocks are rechecked repeatedly during the window.
      const res = await fetch('/api/scan', { cache: 'no-store' });
      const data = await res.json();
      if (data.daily) setStore(data.daily);
      if (!data.ok) throw new Error(data.error ?? 'Live scan failed');

      if (data.batch && data.totalBatches) {
        setMessage(`F&O live scan: batch ${data.batch}/${data.totalBatches} · next scan in 60 sec`);
      } else {
        setMessage('F&O live scan is running.');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    load();
    scan();
    const id = setInterval(() => { load(); scan(); }, 60_000);
    return () => clearInterval(id);
  }, [load, scan]);

  const buys = useMemo(() => store.signals.filter((s) => s.direction === 'BUY').length, [store.signals]);
  const sells = useMemo(() => store.signals.filter((s) => s.direction === 'SELL').length, [store.signals]);

  return (
    <main className="shell">
      <header className="header">
        <div><div className="eyebrow">PRIME TECHNICAL</div><h1>09:15 → 10:00 F&O CAPTURE SCANNER</h1><p>F&O stocks are checked live every 60 seconds during 09:15–10:00 IST. Stocks that meet the Prime Technical condition appear in the scanner immediately and remain saved for the day.</p></div>
        <div className="actions"><span className={`status ${store.dataStatus.toLowerCase()}`}>{store.dataStatus}</span><button onClick={scan} disabled={busy}>{busy ? 'SCANNING…' : 'REFRESH SCAN'}</button></div>
      </header>

      <section className="cards">
        <div className="card"><span>F&O STOCKS SCANNED</span><strong>{store.scannedStocks.length}</strong></div>
        <div className="card"><span>CAPTURED TODAY</span><strong>{store.signals.length}</strong></div>
        <div className="card buy"><span>BUY</span><strong>{buys}</strong></div>
        <div className="card sell"><span>SELL</span><strong>{sells}</strong></div>
        <div className="card"><span>SCAN COUNT</span><strong>{store.scanCount}</strong></div>
        <div className="card wide"><span>LAST SCAN</span><strong>{time(store.lastScanAt)}</strong></div>
      </section>

      <div className="banner"><span className="dot" /> <b>{message}</b><span> F&O only · 09:15–10:00 IST · every 60 sec · list locked after 10:00</span></div>
      {store.error && <div className="error">DATA ERROR: {store.error}. Existing daily records are retained.</div>}

      <section className="panel">
        <div className="panel-head"><div><h2>TODAY'S CAPTURED STOCKS</h2><p>{store.date || '—'} · {store.signals.length} qualifying F&O stock(s) captured during 09:15–10:00</p></div><span className="retained">● RETAINED UNTIL DAY END</span></div>
        <div className="table-wrap"><table><thead><tr><th>CAPTURED</th><th>STOCK</th><th>SIDE</th><th>LEVEL</th><th>PRICE</th><th>PDH</th><th>PDL</th><th>VOL</th><th>20 EMA</th><th>REASON</th></tr></thead>
          <tbody>{store.signals.map((s) => <tr key={`${s.symbol}-${s.direction}-${s.level}`}><td>{time(s.firstSeenAt || s.confirmationTime)}</td><td className="symbol">{s.symbol}</td><td><span className={`pill ${s.direction.toLowerCase()}`}>{s.direction}</span></td><td>{s.level}</td><td>{fmt(s.price)}</td><td>{fmt(s.pdh)}</td><td>{fmt(s.pdl)}</td><td>{s.volumeMultiple.toFixed(1)}x</td><td>{fmt(s.ema20)}</td><td className="reason">{s.reason}</td></tr>)}</tbody>
        </table>{!store.signals.length && <div className="empty">No qualifying F&O stock has been captured in today's 09:15–10:00 window yet.</div>}</div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>TODAY'S F&O STOCKS SCANNED</h2><p>{store.date || '—'} · {store.scannedStocks.length} F&O stock(s) checked during the 09:15–10:00 window</p></div><span className="retained">● RETAINED FOR DAY</span></div>
        <div className="table-wrap"><table><thead><tr><th>#</th><th>STOCK</th><th>NAME</th><th>FIRST SCANNED</th></tr></thead>
          <tbody>{store.scannedStocks.map((s, i) => <tr key={s.symbol}><td>{i + 1}</td><td className="symbol">{s.symbol}</td><td>{s.name}</td><td>{time(s.firstScannedAt)}</td></tr>)}</tbody>
        </table>{!store.scannedStocks.length && <div className="empty">Today's F&O scanned-stock list has not started yet.</div>}</div>
      </section>
      <footer>Scanner only · No orders or trades are executed · Today's F&O scanned and captured lists remain stored for the day · Upstox credentials remain server-side</footer>
    </main>
  );
}
