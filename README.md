# Prime Technical 9:15–10:00 Scanner

Production-oriented NIFTY 500 intraday scanner using Upstox 5-minute OHLCV data.

## Capture rule

The backend only creates new signals during **09:15–10:00 IST**. Once a stock is confirmed during that window, the signal is written to the daily store and is **not removed or replaced later in the day**. A new trading day gets a new daily key.

## Confirmation logic

- PDH = previous completed trading day's high.
- PDL = previous completed trading day's low.
- Execution timeframe = 5 minutes.
- Confirmation uses completed candles only.
- BUY: completed candle closes above PDH, volume multiple >= 2x, price above 20 EMA, then follow-through holds above PDH.
- SELL: completed candle closes below PDL, volume multiple >= 2x, price below 20 EMA, then follow-through holds below PDL.
- No order placement or trading execution is included.

## Persistence

Production persistence uses Upstash Redis via:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Without Redis, local development falls back to process memory only; this is not durable across serverless instances.

## Upstox

Set `UPSTOX_ACCESS_TOKEN` in Vercel environment variables. Never expose it to the browser.

## Deployment

Import this repository into Vercel, add the three production environment variables, then deploy. The included `vercel.json` schedules `/api/scan` every minute; the endpoint itself gates execution to the 09:15–10:00 IST capture window.
