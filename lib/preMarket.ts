import { Redis } from '@upstash/redis';

export type PreMarketRow = {
  symbol: string;
  previousClose?: number;
  indicativePrice?: number;
  gapPercent?: number;
  indicativeQuantity?: number;
  buyQuantity?: number;
  sellQuantity?: number;
  imbalanceQuantity?: number;
  oiChangePercent?: number;
  oiChange?: number;
  direction: 'BULLISH' | 'BEARISH' | 'MIXED';
  score: number;
  sources: string[];
  observedAt: string;
};
export type PreMarketSnapshot = { date: string; updatedAt: string; windowOpen: boolean; rows: PreMarketRow[]; errors: string[]; status: string };

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const memory = new Map<string, PreMarketSnapshot>();
const key = (date: string) => `prime:premarket:${date}`;

export function istNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const minutes = Number(parts.find(p => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return { now, date, minutes };
}
export async function getPreMarket(date: string): Promise<PreMarketSnapshot> {
  const stored = redis ? await redis.get<PreMarketSnapshot>(key(date)) : memory.get(date);
  return stored ?? { date, updatedAt: '', windowOpen: false, rows: [], errors: [], status: 'WAITING' };
}
export async function savePreMarket(snapshot: PreMarketSnapshot) {
  if (redis) await redis.set(key(snapshot.date), snapshot, { ex: 60 * 60 * 24 * 10 });
  else memory.set(snapshot.date, snapshot);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) { const n = Number(v.replace(/[,₹%]/g, '').trim()); if (Number.isFinite(n)) return n; }
  return undefined;
}
function first(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) { const n = num(obj[k]); if (n !== undefined) return n; }
  return undefined;
}
function records(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter(x => x && typeof x === 'object') as Record<string, unknown>[];
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  for (const k of ['data', 'records', 'rows', 'grapthData', 'preOpenMarket']) {
    const v = o[k];
    if (Array.isArray(v)) return v.filter(x => x && typeof x === 'object') as Record<string, unknown>[];
    if (v && typeof v === 'object') {
      const nested = records(v);
      if (nested.length) return nested;
    }
  }
  return [];
}
function rowSymbol(r: Record<string, unknown>): string {
  const nested = r.metadata && typeof r.metadata === 'object' ? r.metadata as Record<string, unknown> : {};
  return String(r.symbol ?? r.Symbol ?? r.underlyingSymbol ?? nested.symbol ?? nested.identifier ?? '').trim().toUpperCase().replace(/[^A-Z0-9&-]/g, '');
}
async function nseJson(path: string): Promise<unknown> {
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129 Safari/537.36';
  const landing = await fetch('https://www.nseindia.com/', {
    cache: 'no-store',
    headers: { Accept: 'text/html,application/xhtml+xml,*/*', 'User-Agent': userAgent },
    signal: AbortSignal.timeout(7000),
  });
  const cookieHeaders = (landing.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const cookie = cookieHeaders.map(v => v.split(';')[0]).filter(Boolean).join('; ');
  const res = await fetch(`https://www.nseindia.com/api/${path}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://www.nseindia.com/market-data/pre-open-market-cm-and-emerge-market',
      'User-Agent': userAgent,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`NSE ${path}: HTTP ${res.status}`);
  return res.json();
}

export async function refreshPreMarket(date: string, now: Date, windowOpen: boolean): Promise<PreMarketSnapshot> {
  const errors: string[] = [];
  const [preOpenResult, oiResult] = await Promise.allSettled([
    nseJson('market-data-pre-open?key=ALL'),
    nseJson('live-analysis-oi-spurts'),
  ]);
  if (preOpenResult.status === 'rejected') errors.push(String(preOpenResult.reason instanceof Error ? preOpenResult.reason.message : preOpenResult.reason));
  if (oiResult.status === 'rejected') errors.push(String(oiResult.reason instanceof Error ? oiResult.reason.message : oiResult.reason));

  const bySymbol = new Map<string, PreMarketRow>();
  if (preOpenResult.status === 'fulfilled') {
    for (const raw of records(preOpenResult.value)) {
      const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata as Record<string, unknown> : {};
      const detail = raw.detail && typeof raw.detail === 'object' ? raw.detail as Record<string, unknown> : {};
      const nested = { ...raw, ...detail, ...metadata };
      const symbol = rowSymbol(raw) || rowSymbol(nested);
      if (!symbol) continue;
      const previousClose = first(nested, ['previousClose', 'prevClose', 'previous_close']);
      const indicativePrice = first(nested, ['iep', 'indicativePrice', 'lastPrice', 'price']);
      const gapPercent = first(nested, ['pChange', 'changePercent', 'perChange']) ??
        (previousClose !== undefined && indicativePrice !== undefined && previousClose !== 0 ? ((indicativePrice - previousClose) / previousClose) * 100 : undefined);
      const indicativeQuantity = first(nested, ['finalQuantity', 'totalTradedVolume', 'quantity', 'totalQuantity', 'totalTradedQuantity']);
      const buyQuantity = first(nested, ['totalBuyQuantity', 'buyQuantity', 'totalBuyQty']);
      const sellQuantity = first(nested, ['totalSellQuantity', 'sellQuantity', 'totalSellQty']);
      const imbalanceQuantity = first(nested, ['iepQty', 'imbalanceQuantity', 'totalBuyQuantityAtEquilibrium']);
      const direction = gapPercent !== undefined && gapPercent > 0.15 ? 'BULLISH' : gapPercent !== undefined && gapPercent < -0.15 ? 'BEARISH' : 'MIXED';
      const score = Math.min(40, Math.round(Math.min(20, Math.abs(gapPercent ?? 0) * 5) + (buyQuantity !== undefined && sellQuantity !== undefined && buyQuantity > sellQuantity * 1.15 ? 10 : sellQuantity !== undefined && buyQuantity !== undefined && sellQuantity > buyQuantity * 1.15 ? 10 : 0) + (indicativeQuantity && indicativeQuantity > 0 ? 10 : 0)));
      bySymbol.set(symbol, { symbol, previousClose, indicativePrice, gapPercent, indicativeQuantity, buyQuantity, sellQuantity, imbalanceQuantity, direction, score, sources: ['NSE Pre-Open'], observedAt: now.toISOString() });
    }
  }
  if (oiResult.status === 'fulfilled') {
    for (const raw of records(oiResult.value)) {
      const symbol = rowSymbol(raw);
      if (!symbol) continue;
      const oiChangePercent = first(raw, ['pchangeInOI', 'changeInOIper', 'changeInOI%', 'perChangeInOI', 'pChange']);
      const oiChange = first(raw, ['changeInOI', 'changeOI', 'netChangeInOI']);
      const existing = bySymbol.get(symbol);
      const positive = (oiChangePercent ?? oiChange ?? 0) > 0;
      const row: PreMarketRow = existing ?? { symbol, direction: 'MIXED', score: 0, sources: [], observedAt: now.toISOString() };
      row.oiChangePercent = oiChangePercent;
      row.oiChange = oiChange;
      row.sources = [...new Set([...row.sources, 'NSE OI Spurts'])];
      row.score = Math.min(100, row.score + Math.min(30, Math.round(Math.abs(oiChangePercent ?? 0) * 0.6)));
      // OI expansion alone has no directional meaning. Keep it MIXED unless
      // pre-open price direction provides independent context.
      if (existing?.gapPercent !== undefined) {
        row.direction = existing.gapPercent > 0.15 ? 'BULLISH' : existing.gapPercent < -0.15 ? 'BEARISH' : 'MIXED';
      } else if (!existing) {
        row.direction = 'MIXED';
      }
      bySymbol.set(symbol, row);
    }
  }
  const previous = await getPreMarket(date);
  const merged = new Map(previous.rows.map(r => [r.symbol, r]));
  for (const [symbol, fresh] of bySymbol) {
    const old = merged.get(symbol);
    merged.set(symbol, old ? { ...old, ...fresh, sources: [...new Set([...old.sources, ...fresh.sources])], score: Math.max(old.score, fresh.score) } : fresh);
  }
  const snapshot: PreMarketSnapshot = {
    date, updatedAt: now.toISOString(), windowOpen, rows: [...merged.values()].sort((a,b) => b.score-a.score || a.symbol.localeCompare(b.symbol)),
    errors, status: errors.length === 0 ? 'OK' : bySymbol.size ? 'PARTIAL' : 'ERROR',
  };
  await savePreMarket(snapshot);
  return snapshot;
}
