import { NextRequest, NextResponse } from 'next/server';
import { getNifty500Symbols, getFiveMinuteCandles } from '@/lib/upstox';
import { evaluateSymbol } from '@/lib/prime';
import { getDaily, mergeDaily } from '@/lib/dailyStore';
import { ScannedStock, Signal } from '@/lib/types';

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

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchCandlesWithRetry(instrumentKey: string, fromDate: string, toDate: string): Promise<Awaited<ReturnType<typeof getFiveMinuteCandles>>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getFiveMinuteCandles(instrumentKey, fromDate, toDate);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /Historical candles (429|500|502|503|504)/.test(message);
      if (!retryable || attempt === 2) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Historical candle request failed');
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
  const afterWindow = minutes > 600;
  const beforeWindow = minutes < 555;

  // Outside the capture window, do not repeatedly rescan 500 symbols every minute.
  // After 10:00, the historical backfill is performed only once for the day.
  const existing = await getDaily(date);
  if (!force && afterWindow && existing.historicalBackfillDone) {
    return NextResponse.json({
      ok: true,
      scanning: false,
      historicalWindow: '09:15–10:00 IST',
      message: "Today's 09:15–10:00 historical scan is already loaded; daily results are retained.",
      daily: existing,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (!force && beforeWindow) {
    return NextResponse.json({ ok: true, scanning: false, message: 'Capture window is 09:15–10:00 IST.', date, daily: existing });
  }

  try {
    const universe = await getNifty500Symbols();
    // Three days cover the previous trading day plus enough 5-minute bars for EMA20/volume.
    const fromDate = dateDaysAgo(3);
    const toDate = date;
    const scanStartedAt = force || afterWindow
      ? `${date}T03:45:00.000Z`
      : new Date().toISOString();

    const signals: Signal[] = [];
    const scannedStocks: ScannedStock[] = universe.map((instrument) => ({
      symbol: instrument.symbol,
      name: instrument.name,
      firstScannedAt: scanStartedAt,
    }));
    let failures = 0;

    // Conservative concurrency reduces 429s. Upstox currently documents 50 req/sec,
    // 500/min and 2000/30min for standard APIs.
    const concurrency = Math.max(1, Math.min(6, Number(process.env.SCAN_CONCURRENCY ?? 6)));

    await mapLimit(universe, concurrency, async (instrument) => {
      try {
        const candles = await fetchCandlesWithRetry(instrument.instrumentKey, fromDate, toDate);
        const signal = evaluateSymbol(
          instrument.symbol,
          instrument.name,
          candles,
          new Date(`${date}T10:00:00+05:30`),
          555,
          600,
        );
        if (signal) signals.push(signal);
      } catch {
        failures += 1;
      }
      return null;
    });

    // Any failed symbol means the scan is PARTIAL; never report a clean ERROR just
    // because the successful symbols happened to produce zero signals.
    const status = failures === 0 ? 'OK' : 'PARTIAL';
    const daily = await mergeDaily(
      date,
      signals,
      status,
      failures ? `${failures} symbols failed during this scan.` : undefined,
      scannedStocks,
      afterWindow || force ? true : existing.historicalBackfillDone,
    );

    return NextResponse.json({
      ok: true,
      scanning: !afterWindow,
      historicalWindow: force || afterWindow ? '09:15–10:00 IST' : undefined,
      universe: universe.length,
      failures,
      daily,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scanner error';
    const daily = await mergeDaily(date, [], 'ERROR', message, [], afterWindow || force ? true : existing.historicalBackfillDone);
    return NextResponse.json({ ok: false, scanning: !afterWindow, daily, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
