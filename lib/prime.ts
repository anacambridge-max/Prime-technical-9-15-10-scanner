import { Candle, Signal } from './types';
import { emaAt } from './indicators';
import { pdhPdl, tradingDate } from './levels';
import { volumeMultiple } from './volume';

export function evaluateSymbol(symbol: string, name: string, candles: Candle[], now = new Date()): Signal | null {
  const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const levels = pdhPdl(candles, istDate);
  if (!levels) return null;

  const today = candles.filter((c) => tradingDate(c.timestamp) === istDate);
  const completed = today.length > 1 ? today.slice(0, -1) : [];
  if (completed.length < 2) return null;

  for (let i = completed.length - 2; i >= 0; i--) {
    const candle = completed[i];
    const candleIndex = candles.indexOf(candle);
    const ema20 = emaAt(candles, candleIndex, 20);
    if (ema20 == null) continue;
    const vol = volumeMultiple(candles, candleIndex, 20);
    const follow = completed[i + 1];
    const followIndex = candles.indexOf(follow);
    if (followIndex <= candleIndex) continue;

    if (candle.close > levels.pdh && candle.high > levels.pdh && candle.close > ema20 && vol.multiple >= 2) {
      if (follow.close <= levels.pdh || follow.low <= levels.pdh) continue;
      return {
        date: istDate, symbol, name, direction: 'BUY', level: 'PDH', status: 'CONFIRMED',
        firstSeenAt: new Date().toISOString(), confirmationTime: follow.timestamp, price: follow.close,
        pdh: levels.pdh, pdl: levels.pdl, breakoutCandle: candle, volumeMultiple: vol.multiple,
        referenceVolume: vol.reference, ema20, followThroughCandle: follow,
        reason: `PDH breakout + bullish follow-through + ${vol.multiple.toFixed(1)}X volume + price above 20 EMA`,
      };
    }

    if (candle.close < levels.pdl && candle.low < levels.pdl && candle.close < ema20 && vol.multiple >= 2) {
      if (follow.close >= levels.pdl || follow.high >= levels.pdl) continue;
      return {
        date: istDate, symbol, name, direction: 'SELL', level: 'PDL', status: 'CONFIRMED',
        firstSeenAt: new Date().toISOString(), confirmationTime: follow.timestamp, price: follow.close,
        pdh: levels.pdh, pdl: levels.pdl, breakoutCandle: candle, volumeMultiple: vol.multiple,
        referenceVolume: vol.reference, ema20, followThroughCandle: follow,
        reason: `PDL breakdown + bearish follow-through + ${vol.multiple.toFixed(1)}X volume + price below 20 EMA`,
      };
    }
  }
  return null;
}
