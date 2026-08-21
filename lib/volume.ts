import { Candle } from './types';

export function volumeMultiple(candles: Candle[], index: number, lookback = 20) {
  const refs = candles.slice(Math.max(0, index - lookback), index).map((c) => c.volume).filter((v) => Number.isFinite(v) && v > 0);
  if (!refs.length) return { multiple: 0, reference: 0 };
  const reference = refs.reduce((a, b) => a + b, 0) / refs.length;
  return { multiple: reference ? candles[index].volume / reference : 0, reference };
}

export function volumeLabel(multiple: number) {
  if (multiple >= 6) return 'EXTREME VOLUME';
  if (multiple >= 4) return 'VERY HIGH VOLUME';
  if (multiple >= 2) return 'HIGH VOLUME';
  if (multiple >= 1.5) return 'STRONG VOLUME';
  return 'NORMAL VOLUME';
}
