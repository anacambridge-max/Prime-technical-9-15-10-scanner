'use client';

import { useCallback, useEffect, useState } from 'react';

type Row = {
  symbol: string; previousClose?: number; indicativePrice?: number; gapPercent?: number;
  indicativeQuantity?: number; buyQuantity?: number; sellQuantity?: number; imbalanceQuantity?: number;
  oiChangePercent?: number; oiChange?: number; direction: 'BULLISH'|'BEARISH'|'MIXED';
  score: number; sources: string[]; observedAt: string;
};
type Common = { symbol:string; name:string; signal:'BUY'|'SELL'; level:string; confirmationTime:string; preMarketDirection:string; preMarketScore:number; gapPercent?:number; oiChangePercent?:number; confluence:'ALIGNED'|'CONFLICT' };
type Payload = { date:string; updatedAt:string; windowOpen:boolean; rows:Row[]; errors:string[]; status:string; session?:{start:string;end:string;timezone:string}; commonConfirmedSignals:Common[]; confirmedSignalCount:number; note?:string };

const num = (v?:number) => v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('en-IN',{maximumFractionDigits:2});
const pct = (v?:number) => v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const clock = (v?:string) => v ? new Date(v).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';

export default function PreMarketPage() {
  const [data,setData] = useState<Payload|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const load = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/pre-market',{cache:'no-store'});
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Unable to load pre-market data');
      setData(json); setError('');
    } catch(e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { setBusy(false); }
  },[busy]);
  useEffect(() => { void load(); const id = setInterval(() => { void load(); }, 15000); return () => clearInterval(id); },[load]);
  const common = data?.commonConfirmedSignals ?? [];

  return <main className="shell">
    <header className="header">
      <div>
        <div className="eyebrow">PRIME TECHNICAL · NSE SESSION INTELLIGENCE</div>
        <h1>PRE-MARKET STUDY · 09:00–09:08 IST</h1>
        <p>Official NSE pre-open indicative data + OI spurts, then matched against the existing BUY/SELL Confirmed Signals.</p>
      </div>
      <div className="actions"><a href="/" style={{color:'#dce5ef',border:'1px solid #26313e',padding:'10px 12px',borderRadius:8,textDecoration:'none',fontSize:12,fontWeight:800}}>← MAIN SCANNER</a><button onClick={() => void load()} disabled={busy}>{busy?'UPDATING…':'REFRESH'}</button></div>
    </header>
    <section className="cards">
      <div className="card"><span>SESSION</span><strong>{data?.windowOpen?'LIVE':data?.updatedAt?'SAVED':'WAITING'}</strong></div>
      <div className="card"><span>PRE-MARKET SYMBOLS</span><strong>{data?.rows.length ?? '—'}</strong></div>
      <div className="card"><span>CONFIRMED SIGNALS</span><strong>{data?.confirmedSignalCount ?? 0}</strong></div>
      <div className="card buy"><span>COMMON STOCKS</span><strong>{common.length}</strong></div>
      <div className="card wide"><span>LAST UPDATE (IST)</span><strong>{clock(data?.updatedAt)}</strong></div>
    </section>
    <div className="banner"><span className="dot"/><b>{data?.windowOpen?'09:00–09:08 session is active':data?.updatedAt?'Latest captured snapshot retained':'Waiting for 09:00 AM IST'}</b><span> · Refresh every 15 sec · NSE data only where returned</span></div>
    {(error || data?.errors?.length) && <div className="error">DATA SOURCE WARNING: {[error,...(data?.errors??[])].filter(Boolean).join(' · ')}. Existing saved rows are retained; unavailable fields are shown as —.</div>}
    <section className="panel">
      <div className="panel-head"><div><h2>PRE-MARKET + OI SPURTS WATCHLIST</h2><p>Ranked by indicative gap/quantity and OI-spurt contribution. Score is a heuristic, not a trade signal.</p></div><span className="retained">{data?.status ?? 'WAITING'}</span></div>
      <div className="table-wrap"><table><thead><tr><th>#</th><th>SYMBOL</th><th>BIAS</th><th>SCORE</th><th>PREV CLOSE</th><th>INDICATIVE PRICE</th><th>GAP %</th><th>OI CHANGE %</th><th>BUY QTY</th><th>SELL QTY</th><th>SOURCE</th></tr></thead>
      <tbody>{(data?.rows??[]).slice(0,100).map((r,i)=><tr key={r.symbol}><td>{i+1}</td><td className="symbol">{r.symbol}</td><td><span className={`pill ${r.direction==='BULLISH'?'buy':r.direction==='BEARISH'?'sell':''}`}>{r.direction}</span></td><td>{r.score}</td><td>{num(r.previousClose)}</td><td>{num(r.indicativePrice)}</td><td>{pct(r.gapPercent)}</td><td>{pct(r.oiChangePercent)}</td><td>{num(r.buyQuantity)}</td><td>{num(r.sellQuantity)}</td><td>{r.sources.join(' + ')}</td></tr>)}</tbody></table>
      {!data?.rows?.length && <div className="empty">No NSE rows returned yet. The official website may not expose data before the session or may block automated requests.</div>}</div>
    </section>
    <section className="panel" style={{marginTop:14}}>
      <div className="panel-head"><div><h2>COMMON STOCKS · PRE-MARKET × CONFIRMED SIGNALS</h2><p>Symbols that appear in the saved pre-market snapshot and today's confirmed scanner signals.</p></div><span className="retained">{common.length} MATCHED</span></div>
      <div className="table-wrap"><table><thead><tr><th>SYMBOL</th><th>CONFIRMED SIDE</th><th>LEVEL</th><th>PRE-MARKET BIAS</th><th>GAP %</th><th>OI CHANGE %</th><th>PRE-MARKET SCORE</th><th>CONFLUENCE</th><th>CONFIRMED AT</th></tr></thead>
      <tbody>{common.map(r=><tr key={r.symbol}><td className="symbol">{r.symbol}</td><td><span className={`pill ${r.signal.toLowerCase()}`}>{r.signal}</span></td><td>{r.level}</td><td>{r.preMarketDirection}</td><td>{pct(r.gapPercent)}</td><td>{pct(r.oiChangePercent)}</td><td>{r.preMarketScore}</td><td><span className={`pill ${r.confluence==='ALIGNED'?'buy':'sell'}`}>{r.confluence}</span></td><td>{clock(r.confirmationTime)}</td></tr>)}</tbody></table>
      {!common.length && <div className="empty">No common symbols yet. Pre-market snapshot is retained and this list will populate when today's BUY/SELL Confirmed signals overlap.</div>}</div>
    </section>
    <div className="banner" style={{marginTop:14}}>{data?.note ?? 'Source values are displayed as received. OI increase alone does not establish bullishness or bearishness because futures/options positioning can be ambiguous.'}</div>
    <footer>Pre-market study only · No orders or trades are executed · Confirmed BUY/SELL engine remains unchanged</footer>
  </main>;
}
