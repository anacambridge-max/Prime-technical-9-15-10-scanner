import { Candle, Signal } from './types';
import { emaAt } from './indicators';
import { pdhPdl, tradingDate } from './levels';
import { volumeMultiple } from './volume';

function minuteOfDayIST(timestamp: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function evaluateSymbol(
  symbol: string,
  name: string,
  candles: Candle[],
  now = new Date(),
  captureStartMinutes = 0,
  captureEndMinutes = 1439,
): Signal | null {
  const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const levels = pdhPdl(candles, istDate);
  if (!levels) return null;

  // Historical backfills can be executed after the market has closed. Never
  // allow candles after the requested capture window to participate in the
  // window scan; otherwise a post-market run could accidentally evaluate a
  // later part of today's session as part of the 09:15–10:00 scan.
  const today = candles.filter((c) =>
    tradingDate(c.timestamp) === istDate &&
    minuteOfDayIST(c.timestamp) <= captureEndMinutes,
  );
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

    // The confirmation candle itself must occur inside the requested
    // 09:15–10:00 IST capture window.
    const confirmationMinute = minuteOfDayIST(follow.timestamp);
    if (confirmationMinute < captureStartMinutes || confirmationMinute > captureEndMinutes) continue;

    if (candle.close > levels.pdh && candle.high > levels.pdh && candle.close > ema20 && vol.multiple >= 2) {
      if (follow.close <= levels.pdh || follow.low <= levels.pdh) continue;
      return {
        date: istDate, symbol, name, direction: 'BUY', level: 'PDH', status: 'CONFIRMED',
        // For both live scans and historical backfills, this should represent
        // the actual signal/confirmation time, not the time the backfill ran.
        firstSeenAt: follow.timestamp, confirmationTime: follow.timestamp, price: follow.close,
        pdh: levels.pdh, pdl: levels.pdl, breakoutCandle: candle, volumeMultiple: vol.multiple,
        referenceVolume: vol.reference, ema20, followThroughCandle: follow,
        reason: `PDH breakout + bullish follow-through + ${vol.multiple.toFixed(1)}X volume + price above 20 EMA`,
      };
    }

    if (candle.close < levels.pdl && candle.low < levels.pdl && candle.close < ema20 && vol.multiple >= 2) {
      if (follow.close >= levels.pdl || follow.high >= levels.pdl) continue;
      return {
        date: istDate, symbol, name, direction: 'SELL', level: 'PDL', status: 'CONFIRMED',
        firstSeenAt: follow.timestamp, confirmationTime: follow.timestamp, price: follow.close,
        pdh: levels.pdh, pdl: levels.pdl, breakoutCandle: candle, volumeMultiple: vol.multiple,
        referenceVolume: vol.reference, ema20, followThroughCandle: follow,
        reason: `PDL breakdown + bearish follow-through + ${vol.multiple.toFixed(1)}X volume + price below 20 EMA`,
      };
    }
  }
  return null;
}
