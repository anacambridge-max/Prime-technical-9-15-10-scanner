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

export async function getFnoStocks(): Promise<Instrument[]> {
  const now = Date.now();
  if (instrumentCache && now - instrumentCacheAt < INSTRUMENT_TTL) return instrumentCache;

  const instrumentsRes = await fetch(NSE_INSTRUMENTS_URL, { cache: 'no-store' });
  if (!instrumentsRes.ok) throw new Error(`Upstox instruments failed: ${instrumentsRes.status}`);

  const bytes = Buffer.from(await instrumentsRes.arrayBuffer());
  const text = gunzipSync(bytes).toString('utf8');
  const raw = JSON.parse(text) as unknown;
  const rows = Array.isArray(raw) ? raw : ((raw as { data?: unknown }).data ?? []);
  const all = rows as Array<Record<string, unknown>>;

  const eqMap = new Map<string, Instrument>();
  for (const row of all) {
    if (row.segment !== 'NSE_EQ' || row.instrument_type !== 'EQ') continue;
    const symbol = String(row.trading_symbol ?? '').trim().toUpperCase();
    if (!symbol) continue;
    eqMap.set(symbol, { symbol, instrumentKey: String(row.instrument_key), name: String(row.name ?? symbol) });
  }

  const fnoSymbols = new Set<string>();
  for (const row of all) {
    if (row.segment !== 'NSE_FO' || row.instrument_type !== 'FUT') continue;
    const underlying = String(row.underlying_symbol ?? row.underlying ?? row.underlying_asset ?? '').trim().toUpperCase();
    if (underlying && eqMap.has(underlying)) fnoSymbols.add(underlying);
  }

  instrumentCache = [...fnoSymbols].map((symbol) => eqMap.get(symbol)!).sort((a, b) => a.symbol.localeCompare(b.symbol));
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
