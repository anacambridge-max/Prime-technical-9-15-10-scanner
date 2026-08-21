import { Redis } from '@upstash/redis';
import { DailyStore, Signal } from './types';

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const memory = new Map<string, DailyStore>();
export function storeKey(date: string) { return `prime:daily:${date}`; }

export async function getDaily(date: string): Promise<DailyStore> {
  if (redis) {
    const value = await redis.get<DailyStore>(storeKey(date));
    return value ?? { date, signals: [], scanCount: 0, dataStatus: 'OK' };
  }
  return memory.get(date) ?? { date, signals: [], scanCount: 0, dataStatus: 'OK' };
}

export async function mergeDaily(date: string, incoming: Signal[], status: DailyStore['dataStatus'], error?: string) {
  const current = await getDaily(date);
  const map = new Map(current.signals.map((s) => [`${s.symbol}:${s.direction}:${s.level}`, s]));
  for (const signal of incoming) {
    const key = `${signal.symbol}:${signal.direction}:${signal.level}`;
    if (!map.has(key)) map.set(key, signal);
  }
  const next: DailyStore = {
    date, signals: [...map.values()].sort((a, b) => a.confirmationTime.localeCompare(b.confirmationTime)),
    lastScanAt: new Date().toISOString(), scanCount: current.scanCount + 1, dataStatus: status, error,
  };
  if (redis) await redis.set(storeKey(date), next);
  else memory.set(date, next);
  return next;
}
