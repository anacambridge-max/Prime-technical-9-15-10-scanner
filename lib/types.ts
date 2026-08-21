export type Candle = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };
export type Instrument = { symbol: string; instrumentKey: string; name: string };
export type SignalStatus = 'WATCH' | 'SETUP' | 'CONFIRMED';
export type Direction = 'BUY' | 'SELL';
export type Signal = {
  date: string; symbol: string; name: string; direction: Direction; level: 'PDH' | 'PDL'; status: SignalStatus;
  firstSeenAt: string; confirmationTime: string; price: number; pdh: number; pdl: number;
  breakoutCandle: Candle; volumeMultiple: number; referenceVolume: number; ema20: number;
  followThroughCandle?: Candle; reason: string;
};
export type ScannedStock = { symbol: string; name: string; firstScannedAt: string };
export type DailyStore = {
  date: string; signals: Signal[]; scannedStocks: ScannedStock[]; lastScanAt?: string; scanCount: number;
  dataStatus: 'OK' | 'PARTIAL' | 'ERROR'; error?: string;
  historicalBackfillDone?: boolean;
};
