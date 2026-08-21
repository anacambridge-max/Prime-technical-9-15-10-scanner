import { Candle } from './types';

export function tradingDate(timestamp: string) { return timestamp.slice(0, 10); }

export function previousCompletedDay(candles: Candle[], currentDate: string) {
  const days = [...new Set(candles.map((c) => tradingDate(c.timestamp)).filter((d) => d < currentDate))].sort();
  return days.at(-1) ?? null;
}

export function pdhPdl(candles: Candle[], currentDate: string) {
  const prev = previousCompletedDay(candles, currentDate);
  if (!prev) return null;
  const day = candles.filter((c) => tradingDate(c.timestamp) === prev);
  if (!day.length) return null;
  return { pdh: Math.max(...day.map((c) => c.high)), pdl: Math.min(...day.map((c) => c.low)), previousDate: prev };
}
