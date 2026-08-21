import { NextRequest, NextResponse } from 'next/server';
import { getNifty500Symbols, getFiveMinuteCandles } from '@/lib/upstox';
import { evaluateSymbol } from '@/lib/prime';
import { getDaily, mergeDaily } from '@/lib/dailyStore';
import { ScannedStock, Signal } from '@/lib/types';

export const maxDuration = 60;

// Keep each live request small enough to finish comfortably inside Vercel's
// function limit. The browser triggers one request every 60 seconds.
const BATCH_SIZE = 12;

function istParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
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

async function fetchCandlesWithRetry(
  instrumentKey: string,
  fromDate: string,
  toDate: string,
): Promise<Awaited<ReturnType<typeof getFiveMinuteCandles>>> {
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
  const { hour, minute, date, now } = istParts();
  const minutes = hour * 60 + minute;
  const force = request.nextUrl.searchParams.get('force') === '1';
  const batchParam = request.nextUrl.searchParams.get('batch');
  const beforeWindow = minutes < 555;
  const afterWindow = minutes > 600;
  const existing = await getDaily(date);

  if (!force && beforeWindow) {
    return NextResponse.json(
      { ok: true, scanning: false, message: 'Capture window is 09:15–10:00 IST.', date, daily: existing },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // After 10:00 there is no historical backfill. Today's live scanned list is
  // already stored in Redis and remains available for the rest of the day.
  if (!force && afterWindow) {
    return NextResponse.json(
      {
        ok: true,
        scanning: false,
        historicalWindow: '09:15–10:00 IST',
        message: "Today's 09:15–10:00 scan is complete; scanned stocks are retained for the day.",
        daily: existing,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const universe = await getNifty500Symbols();
    const totalBatches = Math.ceil(universe.length / BATCH_SIZE);

    if (existing.historicalBatches.length >= totalBatches) {
      return NextResponse.json(
        {
          ok: true,
          scanning: false,
          historicalWindow: '09:15–10:00 IST',
          message: "Today's full NIFTY 500 scan is complete; results are retained for the day.",
          batch: totalBatches,
          totalBatches,
          universe: universe.length,
          failures: 0,
          daily: existing,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    let batch: number;
    if (batchParam != null) {
      const parsed = Number(batchParam);
      batch = Number.isFinite(parsed)
        ? Math.max(0, Math.min(totalBatches - 1, Math.floor(parsed)))
        : 0;
    } else {
      batch = Array.from({ length: totalBatches }, (_, i) => i)
        .find((i) => !existing.historicalBatches.includes(i)) ?? 0;
    }

    if (existing.historicalBatches.includes(batch)) {
      const nextMissing = Array.from({ length: totalBatches }, (_, i) => i)
        .find((i) => !existing.historicalBatches.includes(i));
      if (nextMissing == null) {
        return NextResponse.json(
          { ok: true, scanning: false, historicalWindow: '09:15–10:00 IST', daily: existing },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      batch = nextMissing;
    }

    const fromDate = dateDaysAgo(3);
    const toDate = date;
    const batchItems = universe.slice(batch * BATCH_SIZE, Math.min((batch + 1) * BATCH_SIZE, universe.length));
    const scanStartedAt = now.toISOString();
    const scannedStocks: ScannedStock[] = batchItems.map((instrument) => ({
      symbol: instrument.symbol,
      name: instrument.name,
      firstScannedAt: scanStartedAt,
    }));

    const signals: Signal[] = [];
    let failures = 0;
    const concurrency = Math.max(1, Math.min(4, Number(process.env.SCAN_CONCURRENCY ?? 4)));

    await mapLimit(batchItems, concurrency, async (instrument) => {
      try {
        const candles = await fetchCandlesWithRetry(instrument.instrumentKey, fromDate, toDate);
        const signal = evaluateSymbol(instrument.symbol, instrument.name, candles, now, 555, 600);
        if (signal) signals.push(signal);
      } catch {
        failures += 1;
      }
      return null;
    });

    const status = failures === 0 ? 'OK' : 'PARTIAL';
    const daily = await mergeDaily(
      date,
      signals,
      status,
      failures ? `${failures} symbols failed in batch ${batch + 1}/${totalBatches}.` : undefined,
      scannedStocks,
      { batch, totalBatches, incrementScanCount: true },
    );

    return NextResponse.json(
      {
        ok: true,
        scanning: !afterWindow,
        historicalWindow: '09:15–10:00 IST',
        batch: batch + 1,
        totalBatches,
        batchSize: batchItems.length,
        universe: universe.length,
        failures,
        daily,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scanner error';
    const daily = await mergeDaily(date, [], 'ERROR', message, [], { incrementScanCount: false });
    return NextResponse.json(
      { ok: false, scanning: !afterWindow, daily, error: message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
