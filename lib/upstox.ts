import { gunzipSync } from 'node:zlib';
import { Instrument, Candle } from './types';

const UPSTOX_BASE = 'https://api.upstox.com/v3';
const NSE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';

let instrumentCache: Instrument[] | null = null;
let instrumentCacheAt = 0;
const INSTRUMENT_TTL = 6 * 60 * 60 * 1000;

function authHeaders() {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error('UPSTOX_ACCESS_TOKEN is not configured');
  return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

export async function getNifty500Symbols(): Promise<Instrument[]> {
  const now = Date.now();
  if (instrumentCache && now - instrumentCacheAt < INSTRUMENT_TTL) return instrumentCache;

  const [niftyRes, instrumentsRes] = await Promise.all([
    fetch('https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv', {
      headers: { 'User-Agent': 'Mozilla/5.0 PrimeTechnicalScanner', Referer: 'https://www.niftyindices.com/indices/equity/broad-based-indices', Accept: 'text/csv,*/*' },
      cache: 'no-store',
    }),
    fetch(NSE_INSTRUMENTS_URL, { cache: 'no-store' }),
  ]);

  if (!niftyRes.ok) throw new Error(`NIFTY 500 list failed: ${niftyRes.status}`);
  if (!instrumentsRes.ok) throw new Error(`Upstox instruments failed: ${instrumentsRes.status}`);

  const csv = await niftyRes.text();
  const nseSymbols = new Set(csv.split(/\r?\n/).slice(1).map((line) => line.split(',')[2]?.replaceAll('"', '').trim().toUpperCase()).filter(Boolean));

  const bytes = Buffer.from(await instrumentsRes.arrayBuffer());
  const text = gunzipSync(bytes).toString('utf8');
  const raw = JSON.parse(text) as unknown;
  const rows = Array.isArray(raw) ? raw : ((raw as { data?: unknown }).data ?? []);
  const map = new Map<string, Instrument>();

  for (const row of rows as Array<Record<string, unknown>>) {
    if (row.segment !== 'NSE_EQ' || row.instrument_type !== 'EQ') continue;
    const symbol = String(row.trading_symbol ?? '').toUpperCase();
    if (!nseSymbols.has(symbol)) continue;
    map.set(symbol, { symbol, instrumentKey: String(row.instrument_key), name: String(row.name ?? symbol) });
  }

  instrumentCache = [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  instrumentCacheAt = now;
  return instrumentCache;
}

export async function getFiveMinuteCandles(instrumentKey: string, fromDate: string, toDate: string): Promise<Candle[]> {
  const url = `${UPSTOX_BASE}/historical-candle/${encodeURIComponent(instrumentKey)}/minutes/5/${toDate}/${fromDate}`;
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Historical candles ${res.status}`);
  const json = await res.json() as { data?: { candles?: unknown } };
  const candles = json.data?.candles;
  if (!Array.isArray(candles)) throw new Error('Malformed candle response');
  return candles.filter(Array.isArray).map((c) => ({ timestamp: String(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[5]) }))
    .filter((c) => [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
