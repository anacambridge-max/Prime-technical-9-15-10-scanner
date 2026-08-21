import { NextRequest, NextResponse } from 'next/server';
import { getNifty500Symbols, getFiveMinuteCandles } from '@/lib/upstox';
import { evaluateSymbol } from '@/lib/prime';
import { mergeDaily } from '@/lib/dailyStore';
import { Signal } from '@/lib/types';

export const maxDuration = 60;

function istParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return { hour, minute, date, now };
}

function dateDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function GET(request: NextRequest) {
  const { hour, minute, date } = istParts();
  const minutes = hour * 60 + minute;
  const force = request.nextUrl.searchParams.get('force') === '1';

  if (!force && (minutes < 555 || minutes > 600)) {
    return NextResponse.json({ ok: true, scanning: false, message: 'Capture window is 09:15–10:00 IST.', date });
  }

  try {
    const universe = await getNifty500Symbols();
    const fromDate = dateDaysAgo(7);
    const toDate = date;
    const signals: Signal[] = [];
    let failures = 0;

    await mapLimit(universe, 20, async (instrument) => {
      try {
        const candles = await getFiveMinuteCandles(instrument.instrumentKey, fromDate, toDate);
        const signal = evaluateSymbol(instrument.symbol, instrument.name, candles);
        if (signal) signals.push(signal);
      } catch {
        failures += 1;
      }
      return null;
    });

    const status = failures === 0 ? 'OK' : signals.length ? 'PARTIAL' : 'ERROR';
    const daily = await mergeDaily(date, signals, status, failures ? `${failures} symbols failed during this scan.` : undefined);

    return NextResponse.json({ ok: true, scanning: true, universe: universe.length, failures, daily }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scanner error';
    const daily = await mergeDaily(date, [], 'ERROR', message);
    return NextResponse.json({ ok: false, scanning: true, daily, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
