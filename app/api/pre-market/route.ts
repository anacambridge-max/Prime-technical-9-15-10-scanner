import { NextResponse } from 'next/server';
import { getDaily } from '@/lib/dailyStore';
import { getPreMarket, istNow, refreshPreMarket } from '@/lib/preMarket';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function GET() {
  const { date, now, minutes } = istNow();
  const start = 9 * 60;
  const end = 9 * 60 + 8;
  const windowOpen = minutes >= start && minutes <= end;
  let snapshot = await getPreMarket(date);

  if (windowOpen) {
    try {
      snapshot = await refreshPreMarket(date, now, true);
    } catch (error) {
      snapshot = { ...snapshot, updatedAt: now.toISOString(), windowOpen: true, status: 'ERROR', errors: [error instanceof Error ? error.message : 'Pre-market refresh failed'] };
    }
  } else {
    snapshot = { ...snapshot, windowOpen: false };
  }

  const daily = await getDaily(date);
  const confirmed = daily.signals.filter(s => s.status === 'CONFIRMED');
  const symbols = new Set(snapshot.rows.map(r => r.symbol));
  const common = confirmed.filter(s => symbols.has(s.symbol)).map(s => {
    const pre = snapshot.rows.find(r => r.symbol === s.symbol)!;
    return { symbol: s.symbol, name: s.name, signal: s.direction, level: s.level, confirmationTime: s.confirmationTime, preMarketDirection: pre.direction, preMarketScore: pre.score, gapPercent: pre.gapPercent, oiChangePercent: pre.oiChangePercent, confluence: pre.direction === (s.direction === 'BUY' ? 'BULLISH' : 'BEARISH') ? 'ALIGNED' : 'CONFLICT' };
  });

  return NextResponse.json({
    ...snapshot,
    session: { start: '09:00', end: '09:08', timezone: 'Asia/Kolkata', minutesNow: minutes },
    commonConfirmedSignals: common,
    confirmedSignalCount: confirmed.length,
    note: 'NSE public website data may be delayed, blocked, or unavailable. Missing source values are not inferred.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
