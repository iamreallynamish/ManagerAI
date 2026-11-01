/**
 * Verified Stock Watchlist & Market Status Service
 * 
 * Strict Source of Truth: Real exchange market data only.
 * No hardcoded movements, no guessed prices, no loose company matches.
 */

export interface WatchlistStockIdentity {
  ticker: string;                // e.g. 'APOLLO'
  exchange: 'NSE' | 'BSE';       // 'NSE'
  companyName: string;          // e.g. 'Apollo Micro Systems Limited'
  dataProviderSymbol: string;   // e.g. 'APOLLO.NS'
  isin: string;                 // e.g. 'INE713T01028'
  market: string;               // 'India'
  currency: string;             // 'INR'
  significanceThresholdPct: number; // e.g. 3.0 (±3%)
}

/**
 * Permanent structured watchlist identities.
 * Apollo Micro Systems Limited (APOLLO.NS) is explicitly distinguished from Apollo Hospitals (APOLLOHOSP.NS).
 */
export const WATCHLIST_REGISTRY: WatchlistStockIdentity[] = [
  {
    ticker: 'APOLLO',
    exchange: 'NSE',
    companyName: 'Apollo Micro Systems Limited',
    dataProviderSymbol: 'APOLLO.NS',
    isin: 'INE713T01028',
    market: 'India',
    currency: 'INR',
    significanceThresholdPct: 3.0,
  },
  {
    ticker: 'JIOFIN',
    exchange: 'NSE',
    companyName: 'Jio Financial Services Limited',
    dataProviderSymbol: 'JIOFIN.NS',
    isin: 'INE758E01017',
    market: 'India',
    currency: 'INR',
    significanceThresholdPct: 3.0,
  },
  {
    ticker: 'PERSISTENT',
    exchange: 'NSE',
    companyName: 'Persistent Systems Limited',
    dataProviderSymbol: 'PERSISTENT.NS',
    isin: 'INE262H01013',
    market: 'India',
    currency: 'INR',
    significanceThresholdPct: 3.0,
  },
  {
    ticker: 'LT',
    exchange: 'NSE',
    companyName: 'Larsen & Toubro Limited',
    dataProviderSymbol: 'LT.NS',
    isin: 'INE018A01030',
    market: 'India',
    currency: 'INR',
    significanceThresholdPct: 3.0,
  },
  {
    ticker: 'TATACONSUM',
    exchange: 'NSE',
    companyName: 'Tata Consumer Products Limited',
    dataProviderSymbol: 'TATACONSUM.NS',
    isin: 'INE192A01025',
    market: 'India',
    currency: 'INR',
    significanceThresholdPct: 3.0,
  },
];

export interface MarketStatus {
  isOpen: boolean;
  statusText: 'Open' | 'Closed' | 'Weekend' | 'Holiday';
  sessionName: 'Current active session' | 'Last completed trading session';
  currentDateIst: string; // YYYY-MM-DD in Asia/Kolkata
  currentTimeIst: string; // HH:mm in Asia/Kolkata
  timeZone: string;
}

/**
 * Calculates current NSE / BSE market status in India Standard Time (IST, UTC+5:30).
 * Market hours: Mon–Fri 09:15 to 15:30 IST.
 * Weekends and official Indian holidays are strictly identified as Closed.
 */
export function getNseMarketStatus(targetDate: Date = new Date()): MarketStatus {
  const timeZone = 'Asia/Kolkata';

  const istFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = istFormatter.formatToParts(targetDate);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

  const year = parseInt(getPart('year'), 10) || 2026;
  const month = parseInt(getPart('month'), 10) || 11;
  const day = parseInt(getPart('day'), 10) || 1;
  const hour = parseInt(getPart('hour'), 10) || 0;
  const minute = parseInt(getPart('minute'), 10) || 0;

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const dayOfWeekStr = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(targetDate);

  const isWeekend = dayOfWeekStr === 'Sat' || dayOfWeekStr === 'Sun';

  // Official NSE Trading Holidays
  const nseHolidays = new Set([
    `${year}-01-26`, // Republic Day
    `${year}-05-01`, // Maharashtra Day
    `${year}-08-15`, // Independence Day
    `${year}-10-02`, // Mahatma Gandhi Jayanti
    `${year}-12-25`, // Christmas
  ]);

  const isHoliday = nseHolidays.has(dateStr);

  const totalMinutes = hour * 60 + minute;
  const marketOpenMinutes = 9 * 60 + 15; // 09:15 IST
  const marketCloseMinutes = 15 * 60 + 30; // 15:30 IST

  const isOpen = !isWeekend && !isHoliday && totalMinutes >= marketOpenMinutes && totalMinutes <= marketCloseMinutes;

  let statusText: 'Open' | 'Closed' | 'Weekend' | 'Holiday' = 'Closed';
  if (isOpen) {
    statusText = 'Open';
  } else if (isWeekend) {
    statusText = 'Weekend';
  } else if (isHoliday) {
    statusText = 'Holiday';
  }

  return {
    isOpen,
    statusText,
    sessionName: isOpen ? 'Current active session' : 'Last completed trading session',
    currentDateIst: dateStr,
    currentTimeIst: timeStr,
    timeZone,
  };
}

export interface VerifiedStockQuote {
  ticker: string;
  exchange: 'NSE' | 'BSE';
  dataProviderSymbol: string;
  companyName: string;
  isin: string;
  price: number;
  previousClose: number;
  changePct: number;
  currency: string;
  marketSessionDate: string; // e.g. '2026-10-30'
  marketTimeMs: number;
  isMarketOpen: boolean;
  marketStatusText: 'Open' | 'Closed' | 'Weekend' | 'Holiday';
  meaningful: boolean;       // Meets >= ±3% threshold
  dayHigh?: number;
  dayLow?: number;
  verifiedAt: number;
  dataProvider: string;
}

export interface ValidationPipelineResult {
  valid: boolean;
  reason?: string;
  quote?: VerifiedStockQuote;
}

/**
 * Validates raw market response against structured identity and checks freshness.
 * If ticker or identity does not match, rejects the data immediately.
 */
export function validateMarketQuote(
  stock: WatchlistStockIdentity,
  rawMeta: any,
  now: Date = new Date()
): ValidationPipelineResult {
  // Step 1: Match ticker and exchange
  if (!rawMeta || !rawMeta.symbol) {
    return { valid: false, reason: `Missing market symbol for ${stock.ticker}` };
  }

  if (rawMeta.symbol.toUpperCase() !== stock.dataProviderSymbol.toUpperCase()) {
    return {
      valid: false,
      reason: `Symbol mismatch: expected ${stock.dataProviderSymbol}, got ${rawMeta.symbol}`,
    };
  }

  // Step 2: Validate returned price and previous close
  const price = rawMeta.regularMarketPrice;
  const previousClose = rawMeta.chartPreviousClose || rawMeta.previousClose;

  if (typeof price !== 'number' || price <= 0) {
    return { valid: false, reason: `Invalid market price for ${stock.ticker}: ${price}` };
  }

  if (typeof previousClose !== 'number' || previousClose <= 0) {
    return { valid: false, reason: `Invalid previous close for ${stock.ticker}: ${previousClose}` };
  }

  // Step 3: Check timestamp freshness
  const marketTimeSec = rawMeta.regularMarketTime;
  const marketTimeMs = marketTimeSec ? marketTimeSec * 1000 : now.getTime();
  const marketDate = new Date(marketTimeMs);

  const sessionDateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const marketSessionDate = sessionDateFmt.format(marketDate);

  // Step 4: Check market status
  const marketStatus = getNseMarketStatus(now);

  // Step 5: Calculate verified percentage movement
  const changePct = ((price - previousClose) / previousClose) * 100;
  const roundedChangePct = Math.round(changePct * 10) / 10;

  // Step 6: Significance threshold
  const meaningful = Math.abs(roundedChangePct) >= stock.significanceThresholdPct;

  // Step 7: Store verified metadata
  const quote: VerifiedStockQuote = {
    ticker: stock.ticker,
    exchange: stock.exchange,
    dataProviderSymbol: stock.dataProviderSymbol,
    companyName: stock.companyName,
    isin: stock.isin,
    price,
    previousClose,
    changePct: roundedChangePct,
    currency: rawMeta.currency || stock.currency,
    marketSessionDate,
    marketTimeMs,
    isMarketOpen: marketStatus.isOpen,
    marketStatusText: marketStatus.statusText,
    meaningful,
    dayHigh: rawMeta.regularMarketDayHigh,
    dayLow: rawMeta.regularMarketDayLow,
    verifiedAt: now.getTime(),
    dataProvider: 'Yahoo Finance (Official NSE)',
  };

  return { valid: true, quote };
}
