import { NextRequest, NextResponse } from 'next/server';
import { getFnoStocks, getFiveMinuteCandles } from '@/lib/upstox';
import { evaluateSymbol } from '@/lib/prime';
import { getDaily, mergeDaily } from '@/lib/dailyStore';
import { ScannedStock, Signal } from '@/lib/types';

export const maxDuration = 60;
const BATCH_SIZE = 25;
const START_MINUTES = 555;
const END_MINUTES = 600;

function istParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
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
    try { return await getFiveMinuteCandles(instrumentKey, fromDate, toDate); }
    catch (error) {
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

export async function GET(_request: NextRequest) {
  const { hour, minute, date, now } = istParts();
  const minutes = hour * 60 + minute;
  const existing = await getDaily(date);

  // F&O-only live scanner: 09:15–10:00 IST. After 10:00 the daily result is read-only.
  if (minutes < START_MINUTES) {
    return NextResponse.json({ ok: true, scanning: false, message: 'Scanner starts at 09:15 IST.', date, daily: existing }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (minutes >= END_MINUTES) {
    return NextResponse.json({
      ok: true,
      scanning: false,
      lockedForDay: true,
      message: "09:15–10:00 scan is closed. Today's scanned and captured stocks are retained for the day.",
      daily: existing,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const universe = await getFnoStocks();
    if (!universe.length) throw new Error('No NSE F&O stocks found in Upstox instruments data');

    const totalBatches = Math.ceil(universe.length / BATCH_SIZE);
    const batch = existing.scanCount % totalBatches;
    const batchItems = universe.slice(batch * BATCH_SIZE, Math.min((batch + 1) * BATCH_SIZE, universe.length));
    const fromDate = dateDaysAgo(3);
    const scanStartedAt = now.toISOString();

    const scannedStocks: ScannedStock[] = batchItems.map((instrument) => ({
      symbol: instrument.symbol,
      name: instrument.name,
      firstScannedAt: scanStartedAt,
    }));

    const signals: Signal[] = [];
    let failures = 0;
    const concurrency = Math.max(1, Math.min(5, Number(process.env.SCAN_CONCURRENCY ?? 5)));

    await mapLimit(batchItems, concurrency, async (instrument) => {
      try {
        const candles = await fetchCandlesWithRetry(instrument.instrumentKey, fromDate, date);
        const signal = evaluateSymbol(instrument.symbol, instrument.name, candles, now, START_MINUTES, END_MINUTES);
        if (signal) signals.push(signal);
      } catch { failures += 1; }
      return null;
    });

    const status = failures === 0 ? 'OK' : 'PARTIAL';
    const daily = await mergeDaily(
      date,
      signals,
      status,
      failures ? `${failures} F&O stocks failed in this live batch.` : undefined,
      scannedStocks,
      { incrementScanCount: true },
    );

    return NextResponse.json({ ok: true, scanning: true, window: '09:15–10:00 IST', universe: 'NSE F&O', universeSize: universe.length, batch: batch + 1, totalBatches, batchSize: batchItems.length, failures, daily }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scanner error';
    const daily = await mergeDaily(date, [], 'ERROR', message, [], { incrementScanCount: false });
    return NextResponse.json({ ok: false, scanning: true, daily, error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
