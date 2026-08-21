import { Redis } from '@upstash/redis';
import { DailyStore, ScannedStock, Signal } from './types';

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const memory = new Map<string, DailyStore>();
export function storeKey(date: string) { return `prime:daily:${date}`; }

const emptyStore = (date: string): DailyStore => ({ date, signals: [], scannedStocks: [], scanCount: 0, dataStatus: 'OK' });

export async function getDaily(date: string): Promise<DailyStore> {
  if (redis) {
    const value = await redis.get<DailyStore>(storeKey(date));
    if (!value) return emptyStore(date);
    return { ...value, signals: value.signals ?? [], scannedStocks: value.scannedStocks ?? [] };
  }
  const value = memory.get(date);
  return value ? { ...value, signals: value.signals ?? [], scannedStocks: value.scannedStocks ?? [] } : emptyStore(date);
}

export async function mergeDaily(date: string, incoming: Signal[], status: DailyStore['dataStatus'], error?: string, scanned: ScannedStock[] = []) {
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
  const next: DailyStore = {
    date,
    signals: [...signalMap.values()].sort((a, b) => (a.firstSeenAt || a.confirmationTime).localeCompare(b.firstSeenAt || b.confirmationTime)),
    scannedStocks: [...scannedMap.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    lastScanAt: new Date().toISOString(),
    scanCount: current.scanCount + 1,
    dataStatus: status,
    error,
  };
  if (redis) await redis.set(storeKey(date), next);
  else memory.set(date, next);
  return next;
}
