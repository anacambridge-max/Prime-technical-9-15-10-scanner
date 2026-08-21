import { Candle } from './types';

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

export function emaAt(candles: Candle[], index: number, period = 20): number | null {
  if (index + 1 < period) return null;
  return ema(candles.slice(0, index + 1).map((c) => c.close), period);
}
