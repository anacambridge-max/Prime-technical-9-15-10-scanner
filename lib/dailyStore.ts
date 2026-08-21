import { Redis } from '@upstash/redis';
import { DailyStore, ScannedStock, Signal } from './types';

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const memory = new Map<string, DailyStore>();
export function storeKey(date: string) { return `prime:daily:${date}`; }

const emptyStore = (date: string): DailyStore => ({
  date,
  signals: [],
  scannedStocks: [],
  scanCount: 0,
  dataStatus: 'OK',
  historicalBatches: [],
  historicalBackfillDone: false,
});

function normalize(value: DailyStore | null | undefined, date: string): DailyStore {
  if (!value) return emptyStore(date);
  return {
    ...value,
    signals: value.signals ?? [],
    scannedStocks: value.scannedStocks ?? [],
    historicalBatches: value.historicalBatches ?? [],
    historicalBackfillDone: value.historicalBackfillDone ?? false,
  };
}

export async function getDaily(date: string): Promise<DailyStore> {
  if (redis) return normalize(await redis.get<DailyStore>(storeKey(date)), date);
  return normalize(memory.get(date), date);
}

export async function mergeDaily(
  date: string,
  incoming: Signal[],
  status: DailyStore['dataStatus'],
  error?: string,
  scanned: ScannedStock[] = [],
  opts: { batch?: number; totalBatches?: number; incrementScanCount?: boolean } = {},
) {
  const current = await getDaily(date);
  const signalMap = new Map(current.signals.map((s) => [`${s.symbol}:${s.direction}:${s.level}`, s]));
  for (const signal of incoming) {
    const key = `${signal.symbol}:${signal.direction}:${signal.level}`;
    if (!signalMap.has(key)) signalMap.set(key, signal);
  }

  const scannedMap = new Map(current.scannedStocks.map((s) => [s.symbol, s]));
  for (const stock of scanned) {
    if (!scannedMap.has(stock.symbol)) scannedMap.set(stock.symbol, stock);
  }

  const historicalBatches = [...current.historicalBatches];
  if (opts.batch != null && !historicalBatches.includes(opts.batch)) historicalBatches.push(opts.batch);
  historicalBatches.sort((a, b) => a - b);
  const totalBatches = opts.totalBatches ?? historicalBatches.length;
  const historicalBackfillDone = totalBatches > 0 && historicalBatches.length >= totalBatches;

  const next: DailyStore = {
    date,
    signals: [...signalMap.values()].sort((a, b) => (a.firstSeenAt || a.confirmationTime).localeCompare(b.firstSeenAt || b.confirmationTime)),
    scannedStocks: [...scannedMap.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    lastScanAt: new Date().toISOString(),
    scanCount: current.scanCount + (opts.incrementScanCount === false ? 0 : 1),
    dataStatus: status,
    error,
    historicalBatches,
    historicalBackfillDone,
  };

  if (redis) await redis.set(storeKey(date), next);
  else memory.set(date, next);
  return next;
}
