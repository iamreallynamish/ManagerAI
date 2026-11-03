import express, { Request, Response } from 'express';
import {
  KairoActivity,
  SpendIqRawTransaction,
  PersonalReminder,
  StockQuote,
  SinceLastCheckedItem,
  WeeklyRecapData,
  PortfolioHolding,
} from '../src/types/activity.js';
import {
  WATCHLIST_REGISTRY,
  USER_PORTFOLIO_HOLDINGS,
  TOTAL_PORTFOLIO_COST_BASIS,
  getNseMarketStatus,
  validateMarketQuote,
} from '../src/services/stockService.js';
import { scoreEmailMessage } from '../src/services/emailIntelligence.js';

import spendiqFallback from '../src/data/spendiq_fallback.json';

const app = express();
app.use(express.json());

// Normalize incoming URL so both /api/foo and /foo match properly regardless of Vercel or local Express routing
app.use((req, _res, next) => {
  if (req.url && !req.url.startsWith('/api') && req.url !== '/' && !req.url.startsWith('/api/')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

// --- CLOUD DATA CONFIGURATION ---
const SPEND_IQ_RTDB_URL =
  'https://spendiq-7de3d-default-rtdb.asia-southeast1.firebasedatabase.app/spendiq_family_ledger/transactions.json';

const KAIRO_RTDB_STORE_URL =
  'https://spendiq-7de3d-default-rtdb.asia-southeast1.firebasedatabase.app/kairo_store.json';

// Build and runtime metadata
const BUILD_METADATA = {
  buildId: 'kairo-prod-2026.11.02-portfolio-update',
  gitCommit: 'b94e311a-production-refinement',
  deploymentTimestamp: '2026-11-02T13:00:00Z',
  environment: process.env.VERCEL ? 'vercel-production' : (process.env.NODE_ENV || 'development'),
  runtime: process.env.VERCEL ? 'vercel-serverless-node' : 'node-express',
};

export interface StoredCalendarEvent {
  id: string; // Google event ID
  calendarId: string; // External calendar ID
  accountEmail?: string;
  summary: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  startDateTime?: string;
  startDate?: string;
  endDateTime?: string;
  endDate?: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  status: string; // 'confirmed' | 'tentative' | 'cancelled'
  recurringEventId?: string;
  updatedAt: number;
}

export interface CalendarSyncMetadata {
  lastSyncTimestamp: number;
  lastSuccessfulSyncTime?: string;
  status: 'idle' | 'syncing' | 'connected' | 'failed';
  errorMessage?: string;
  accountEmail?: string;
  calendarsDiscovered: { id: string; summary: string; primary?: boolean }[];
  eventsStoredCount: number;
  upcomingEventsCount: number;
  syncTokens: { [calendarId: string]: string };
}

export interface KairoStore {
  userState: {
    [userId: string]: {
      last_checked_at: number;
      updated_at: number;
    };
  };
  portfolio: {
    holdings: PortfolioHolding[];
    totalCostBasis: number;
    updatedAt: number;
  };
  reminders: PersonalReminder[];
  snapshots: {
    calendarEvents: { [id: string]: { summary: string; startTime: string; lastSeen: number } };
    assignments: { [id: string]: { title: string; dueTimestamp: number; lastSeen: number } };
    txIds: string[];
    cachedTransactions?: SpendIqRawTransaction[];
  };
  calendarData?: {
    events: { [id: string]: StoredCalendarEvent };
    syncMetadata: CalendarSyncMetadata;
  };
}

const DEFAULT_STORE: KairoStore = {
  userState: {
    default: {
      last_checked_at: Date.now() - 2 * 60 * 60 * 1000,
      updated_at: Date.now(),
    },
    namish: {
      last_checked_at: Date.now() - 2 * 60 * 60 * 1000,
      updated_at: Date.now(),
    },
  },
  portfolio: {
    holdings: USER_PORTFOLIO_HOLDINGS,
    totalCostBasis: TOTAL_PORTFOLIO_COST_BASIS,
    updatedAt: Date.now(),
  },
  reminders: [
    {
      id: 'rem_india_flights',
      user_id: 'default',
      title: 'Book India flights',
      details: 'Target booking window: Nov 8–21 · Outbound Jan 5, 2027, Return Apr 5, 2027',
      target_date: '2026-11-21',
      target_date_flexibility: 'week_of',
      status: 'active',
      priority: 'high',
      created_at: Date.now() - 86400000,
      updated_at: Date.now() - 86400000,
      completed_at: null,
      is_travel: true,
      flights_booked: false,
      travel_start_date: '2027-01-05',
      travel_end_date: '2027-04-05',
      completed: false,
      context: 'Target booking window: Nov 8–21 · Outbound Jan 5, Return Apr 5',
      dueDate: '2026-11-21',
    },
  ],
  snapshots: {
    calendarEvents: {},
    assignments: {},
    txIds: [],
    cachedTransactions: [],
  },
  calendarData: {
    events: {},
    syncMetadata: {
      lastSyncTimestamp: 0,
      status: 'idle',
      calendarsDiscovered: [],
      eventsStoredCount: 0,
      upcomingEventsCount: 0,
      syncTokens: {},
    },
  },
};

// In-memory store cache for fast serverless execution
let memoryStore: KairoStore = { ...DEFAULT_STORE };
let storeLoaded = false;
let storeLastSynced = 0;
const STORE_SYNC_INTERVAL_MS = 60 * 1000; // 1 minute

async function getStore(): Promise<KairoStore> {
  const now = Date.now();
  if (storeLoaded && now - storeLastSynced < STORE_SYNC_INTERVAL_MS) {
    return memoryStore;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(KAIRO_RTDB_STORE_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const cloudData = await res.json();
      if (cloudData && typeof cloudData === 'object') {
        const loadedReminders = Array.isArray(cloudData.reminders)
          ? cloudData.reminders
          : Object.values(cloudData.reminders || {});

        // Strict truth enforcement: India flights are NOT booked unless explicitly confirmed
        for (const r of loadedReminders) {
          if (r && r.id === 'rem_india_flights') {
            if (r.details?.includes('Flights confirmed') || r.details?.includes('Flights booked') || r.details?.includes('India flights are booked') || r.completed) {
              r.status = 'active';
              r.completed = false;
              r.flights_booked = false;
              r.completed_at = null;
              r.details = 'Target booking window: Nov 8–21 · Outbound Jan 5, 2027, Return Apr 5, 2027';
              r.context = r.details;
              r.title = 'Book India flights';
            }
          }
        }

        const loadedCalendarEvents: { [id: string]: StoredCalendarEvent } =
          cloudData.calendarData?.events && typeof cloudData.calendarData.events === 'object'
            ? cloudData.calendarData.events
            : {};

        const loadedSyncMeta: CalendarSyncMetadata = {
          ...DEFAULT_STORE.calendarData!.syncMetadata,
          ...(cloudData.calendarData?.syncMetadata || {}),
          syncTokens: cloudData.calendarData?.syncMetadata?.syncTokens || {},
          calendarsDiscovered: cloudData.calendarData?.syncMetadata?.calendarsDiscovered || [],
        };

        memoryStore = {
          ...DEFAULT_STORE,
          ...cloudData,
          userState: { ...DEFAULT_STORE.userState, ...(cloudData.userState || {}) },
          portfolio: cloudData.portfolio?.holdings?.length ? cloudData.portfolio : DEFAULT_STORE.portfolio,
          reminders: loadedReminders.length > 0 ? loadedReminders : DEFAULT_STORE.reminders,
          snapshots: { ...DEFAULT_STORE.snapshots, ...(cloudData.snapshots || {}) },
          calendarData: {
            events: loadedCalendarEvents,
            syncMetadata: loadedSyncMeta,
          },
        };
        storeLoaded = true;
        storeLastSynced = now;
        return memoryStore;
      }
    }
  } catch (err: any) {
    console.warn('[Kairo Cloud Store] Could not fetch RTDB store, using memory cache:', err.message);
  }

  return memoryStore;
}

async function persistStore(patch: Partial<KairoStore>): Promise<void> {
  Object.assign(memoryStore, patch);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    await fetch(KAIRO_RTDB_STORE_URL, {
      method: 'PATCH',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    clearTimeout(timeout);
    storeLastSynced = Date.now();
  } catch (err: any) {
    console.warn('[Kairo Cloud Store] Failed to sync patch to RTDB:', err.message);
  }
}

// Timezone and date helpers
function getDateKey(date: Date, timeZone: string): string {
  try {
    const dFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return dFmt.format(date); // YYYY-MM-DD
  } catch {
    return date.toISOString().split('T')[0];
  }
}

function formatSessionDate(dateStr?: string): string {
  if (!dateStr) return 'Oct 30';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return dateStr;
  }
}

function formatDateTime(timestampMs: number, timeZone: string = 'Asia/Tokyo') {
  try {
    const date = new Date(timestampMs);
    const now = new Date();

    const targetDateKey = getDateKey(date, timeZone);
    const todayDateKey = getDateKey(now, timeZone);

    const tomorrowDate = new Date(now.getTime() + 86400000);
    const tomorrowDateKey = getDateKey(tomorrowDate, timeZone);

    const yesterdayDate = new Date(now.getTime() - 86400000);
    const yesterdayDateKey = getDateKey(yesterdayDate, timeZone);

    let dateHeader: string;
    if (targetDateKey === todayDateKey) {
      dateHeader = 'TODAY';
    } else if (targetDateKey === tomorrowDateKey) {
      dateHeader = 'TOMORROW';
    } else if (targetDateKey === yesterdayDateKey) {
      dateHeader = 'YESTERDAY';
    } else {
      const headerFmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      dateHeader = headerFmt.format(date).toUpperCase();
    }

    const tFmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const timeString = tFmt.format(date);

    return { dateKey: targetDateKey, dateHeader, timeString };
  } catch {
    const d = new Date(timestampMs);
    return {
      dateKey: d.toISOString().split('T')[0],
      dateHeader: d.toDateString().toUpperCase(),
      timeString: d.toLocaleTimeString(),
    };
  }
}

// --- 1. USER STATE & "SINCE YOU LAST CHECKED" ---
app.get('/api/user/state', async (req: Request, res: Response) => {
  try {
    const store = await getStore();
    const userId = (req.query.userId as string) || 'default';
    const userState = store.userState[userId] || {
      last_checked_at: Date.now() - 2 * 60 * 60 * 1000,
      updated_at: Date.now(),
    };
    return res.status(200).json({ success: true, userState });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/user/mark-checked', async (req: Request, res: Response) => {
  try {
    const store = await getStore();
    const userId = (req.body.userId as string) || 'default';
    const now = Date.now();
    store.userState[userId] = {
      last_checked_at: now,
      updated_at: now,
    };
    await persistStore({ userState: store.userState });
    return res.status(200).json({ success: true, last_checked_at: now });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --- 2. PERSONAL REMINDERS & TRAVEL SYSTEM ---
app.get('/api/reminders', async (req: Request, res: Response) => {
  try {
    const store = await getStore();
    const userId = (req.query.userId as string) || 'default';
    const list = store.reminders.filter(
      (r) => !r.user_id || r.user_id === 'default' || r.user_id === userId
    );
    return res.status(200).json({ success: true, reminders: list });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reminders', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<PersonalReminder>;
    if (!body.title) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }

    const store = await getStore();
    const userId = body.user_id || body.userId || 'default';
    const now = Date.now();

    const newReminder: PersonalReminder = {
      id: body.id || `rem_${now}_${Math.random().toString(36).substring(2, 7)}`,
      user_id: userId,
      title: body.title.trim(),
      details: body.details || body.context || '',
      target_date: body.target_date || body.dueDate,
      target_date_flexibility: body.target_date_flexibility || 'exact',
      status: body.status || (body.completed ? 'completed' : 'active'),
      priority: body.priority || 'medium',
      created_at: body.created_at || body.createdAt || now,
      updated_at: now,
      completed_at: body.completed_at || (body.completed ? now : null),
      is_travel: !!body.is_travel,
      flights_booked: !!body.flights_booked,
      travel_start_date: body.travel_start_date,
      travel_end_date: body.travel_end_date,
      completed: body.status === 'completed' || !!body.completed,
      context: body.details || body.context || '',
      dueDate: body.target_date || body.dueDate,
    };

    const existingIdx = store.reminders.findIndex((r) => r.id === newReminder.id);
    if (existingIdx >= 0) {
      store.reminders[existingIdx] = newReminder;
    } else {
      store.reminders.unshift(newReminder);
    }

    await persistStore({ reminders: store.reminders });
    return res.status(200).json({ success: true, reminder: newReminder, reminders: store.reminders });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reminders/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const store = await getStore();
    const target = store.reminders.find((r) => r.id === id);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Reminder not found' });
    }

    target.status = status;
    target.updated_at = Date.now();
    target.completed = status === 'completed';
    target.completed_at = status === 'completed' ? Date.now() : null;

    await persistStore({ reminders: store.reminders });
    return res.status(200).json({ success: true, reminder: target, reminders: store.reminders });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reminders/:id/flights-booked', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const store = await getStore();
    const target = store.reminders.find((r) => r.id === id);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Reminder not found' });
    }

    target.status = 'completed';
    target.completed = true;
    target.completed_at = Date.now();
    target.flights_booked = true;
    target.details = 'Flights booked. Trip dates: January 5, 2027 – April 5, 2027.';
    target.context = target.details;
    target.updated_at = Date.now();

    await persistStore({ reminders: store.reminders });
    return res.status(200).json({ success: true, reminder: target, reminders: store.reminders });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/reminders/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const store = await getStore();
    store.reminders = store.reminders.filter((r) => r.id !== id);
    await persistStore({ reminders: store.reminders });
    return res.status(200).json({ success: true, reminders: store.reminders });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --- 3. VERIFIED STOCK WATCHLIST SERVICE ---
let stockCache: { quotes: StockQuote[]; timestamp: number } | null = null;
const STOCK_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

async function fetchWatchlistQuotes(): Promise<StockQuote[]> {
  const now = new Date();
  if (stockCache && now.getTime() - stockCache.timestamp < STOCK_CACHE_TTL) {
    return stockCache.quotes;
  }

  const quotes: StockQuote[] = [];

  for (const item of WATCHLIST_REGISTRY) {
    try {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        item.dataProviderSymbol
      )}?range=2d&interval=1d`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          Accept: 'application/json',
        },
      });

      if (!resp.ok) {
        console.warn(`Market provider returned HTTP ${resp.status} for ${item.dataProviderSymbol}`);
        continue;
      }

      const data = await resp.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) continue;

      const validation = validateMarketQuote(item, meta, now);
      if (!validation.valid || !validation.quote) {
        console.warn(`Market data validation rejected for ${item.ticker}: ${validation.reason}`);
        continue;
      }

      const vq = validation.quote;
      quotes.push({
        ticker: vq.ticker,
        exchange: vq.exchange,
        symbol: vq.dataProviderSymbol,
        name: vq.companyName,
        companyName: vq.companyName,
        isin: vq.isin,
        price: vq.price,
        previousClose: vq.previousClose,
        changePct: vq.changePct,
        currency: vq.currency,
        marketSessionDate: vq.marketSessionDate,
        isMarketOpen: vq.isMarketOpen,
        marketStatusText: vq.marketStatusText,
        sessionLabel: vq.isMarketOpen ? 'Live Session' : 'Last Session',
        meaningful: vq.meaningful,
        dayHigh: vq.dayHigh,
        dayLow: vq.dayLow,
        verifiedAt: vq.verifiedAt,
        dataProvider: vq.dataProvider,
      });
    } catch (err: any) {
      console.warn(`Failed to fetch verified quote for ${item.ticker} (${item.dataProviderSymbol}):`, err.message);
    }
  }

  if (quotes.length > 0) {
    stockCache = { quotes, timestamp: now.getTime() };
  }

  return quotes;
}

app.get('/api/stocks/watchlist', async (req: Request, res: Response) => {
  try {
    const timeZone = (req.query.timeZone as string) || 'Asia/Tokyo';
    const quotes = await fetchWatchlistQuotes();
    const now = new Date();
    const todayKey = getDateKey(now, timeZone);
    const { timeString } = formatDateTime(now.getTime(), timeZone);
    const marketStatus = getNseMarketStatus(now);

    const meaningfulQuotes = quotes.filter((q) => q.meaningful);

    const activities: KairoActivity[] = meaningfulQuotes.map((q) => {
      const isGain = q.changePct >= 0;
      const formattedPercent = `${Math.abs(q.changePct).toFixed(1)}%`;
      const sign = isGain ? '+' : '-';
      const formattedChange = `${sign}${formattedPercent}`;
      const directionWord = isGain ? 'up' : 'down';
      const formattedPrice = q.price.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      let title = '';
      let detail = '';
      let dateKey = todayKey;
      let dateHeader = 'TODAY';
      let activityTimeString = timeString;

      if (q.isMarketOpen) {
        title = `${q.companyName} is ${directionWord} ${formattedPercent} in today's active trading session.`;
        detail = `₹${formattedPrice} · ${formattedChange} · NSE Live Trading`;
        dateKey = todayKey;
        dateHeader = 'TODAY';
        activityTimeString = timeString;
      } else {
        // Strict adherence to Market Closed wording rules:
        // "Market closed · Last session Oct 30. Apollo Micro Systems closed at ₹398.75, down 5.4%."
        const formattedDate = formatSessionDate(q.marketSessionDate);
        title = `Market closed · Last session ${formattedDate}. ${q.companyName} closed at ₹${formattedPrice}, ${directionWord} ${formattedPercent}.`;
        detail = `₹${formattedPrice} · ${formattedChange} · NSE · Market closed`;
        dateKey = q.marketSessionDate || todayKey;
        dateHeader = `LAST SESSION · ${formattedDate.toUpperCase()}`;
        activityTimeString = 'Market Closed';
      }

      return {
        id: `stock_${q.ticker || q.symbol.replace('.', '_')}_${q.marketSessionDate || todayKey}`,
        source: 'stocks',
        activityType: 'stock_move',
        title,
        detail,
        relatedEntityId: q.symbol,
        occurredAt: q.verifiedAt || now.getTime(),
        timestamp: q.verifiedAt || now.getTime(),
        createdAt: now.getTime(),
        dateKey,
        dateHeader,
        timeString: activityTimeString,
        provenance: {
          sourceName: 'NSE Market Provider',
          verified: true,
          recordTimestamp: q.verifiedAt || now.getTime(),
          dataProvider: q.dataProvider || 'Yahoo Finance (Official NSE)',
          marketSessionDate: q.marketSessionDate,
          isMarketOpen: q.isMarketOpen,
        },
        stockData: {
          ticker: q.ticker,
          exchange: q.exchange,
          symbol: q.symbol,
          companyName: q.companyName,
          price: q.price,
          previousClose: q.previousClose,
          changePct: q.changePct,
          currency: q.currency,
          marketSessionDate: q.marketSessionDate,
          isMarketOpen: q.isMarketOpen,
          sessionLabel: q.sessionLabel,
          dayHigh: q.dayHigh,
          dayLow: q.dayLow,
          dataProvider: q.dataProvider,
        },
      };
    });

    const store = await getStore();
    const portfolio = store.portfolio || DEFAULT_STORE.portfolio;

    return res.status(200).json({
      success: true,
      marketStatus,
      quotes,
      meaningfulQuotes,
      activities,
      portfolio: {
        holdings: portfolio.holdings,
        totalCostBasis: portfolio.totalCostBasis,
        updatedAt: portfolio.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error fetching stock watchlist:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// User Persistent Portfolio Holdings Endpoint
app.get('/api/portfolio', async (_req: Request, res: Response) => {
  try {
    const store = await getStore();
    const portfolio = store.portfolio || DEFAULT_STORE.portfolio;
    return res.status(200).json({
      success: true,
      holdings: portfolio.holdings,
      totalCostBasis: portfolio.totalCostBasis,
      currency: 'INR',
      count: portfolio.holdings.length,
      updatedAt: portfolio.updatedAt,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --- 4. SPEND IQ SERVICE ---
async function fetchSpendIqRawTransactions(): Promise<SpendIqRawTransaction[]> {
  const store = await getStore();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(SPEND_IQ_RTDB_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const rawData = await response.json();
      let list: SpendIqRawTransaction[] = [];
      if (Array.isArray(rawData)) {
        list = rawData.filter(Boolean);
      } else if (rawData && typeof rawData === 'object') {
        list = Object.values(rawData).filter(Boolean) as SpendIqRawTransaction[];
      }
      if (list.length > 0) {
        store.snapshots.cachedTransactions = list;
        persistStore({ snapshots: store.snapshots }).catch(() => {});
        return list;
      }
    } else {
      console.warn(`Spend IQ RTDB returned HTTP ${response.status}`);
    }
  } catch (err: any) {
    console.warn('Spend IQ RTDB fetch failed or timed out:', err.message);
  }

  if (store.snapshots.cachedTransactions && store.snapshots.cachedTransactions.length > 0) {
    return store.snapshots.cachedTransactions;
  }

  // Resilient fallback to static seed snapshot so ledger is never blank
  if (Array.isArray(spendiqFallback) && spendiqFallback.length > 0) {
    return spendiqFallback as SpendIqRawTransaction[];
  }

  return [];
}

app.get('/api/spendiq/transactions', async (req: Request, res: Response) => {
  try {
    const timeZone = (req.query.timeZone as string) || 'Asia/Tokyo';
    const showAllSpenders = req.query.showAllSpenders !== 'false';
    const spenderFilter = req.query.spender as string | undefined;
    const limitDays = req.query.limitDays !== undefined ? parseInt(req.query.limitDays as string, 10) : 90;

    const transactions = await fetchSpendIqRawTransactions();

    if (!transactions || transactions.length === 0) {
      return res.status(200).json({
        success: true,
        activities: [],
        count: 0,
        spendingContext: {
          todaySpentJpy: 0,
          todaySpentInr: 0,
          todayTxCount: 0,
          weekSpentJpy: 0,
          weekSpentInr: 0,
        },
      });
    }

    const now = new Date();
    const todayKey = getDateKey(now, timeZone);
    const cutoffDate = new Date(now.getTime() - (limitDays > 0 ? limitDays : 90) * 86400000);
    const cutoffDateKey = getDateKey(cutoffDate, timeZone);

    let filteredTxs = transactions.filter((tx) => {
      if (!tx || !tx.id) return false;
      if (spenderFilter) return tx.spender === spenderFilter;
      if (!showAllSpenders) return tx.spender === 'Son';

      if (limitDays > 0 && tx.timestampMs) {
        const txDateKey = getDateKey(new Date(tx.timestampMs), timeZone);
        if (txDateKey < cutoffDateKey) {
          return false;
        }
      }
      return true;
    });

    // If date filtering resulted in zero transactions, keep the most recent transactions
    // rather than showing an empty screen
    if (filteredTxs.length === 0 && transactions.length > 0) {
      filteredTxs = transactions.filter((tx) => {
        if (!tx || !tx.id) return false;
        if (spenderFilter) return tx.spender === spenderFilter;
        if (!showAllSpenders) return tx.spender === 'Son';
        return true;
      }).slice(0, 30);
    }

    let todaySpentJpy = 0;
    let todaySpentInr = 0;
    let todayTxCount = 0;
    let weekSpentJpy = 0;
    let weekSpentInr = 0;

    for (const tx of filteredTxs) {
      if (tx.amountJpy) weekSpentJpy += tx.amountJpy;
      if (tx.amountInr) weekSpentInr += tx.amountInr;

      if (tx.timestampMs) {
        const txDateKey = getDateKey(new Date(tx.timestampMs), timeZone);
        if (txDateKey === todayKey) {
          if (tx.amountJpy) todaySpentJpy += tx.amountJpy;
          if (tx.amountInr) todaySpentInr += tx.amountInr;
          todayTxCount++;
        }
      }
    }

    const groupKeyMap = new Map<string, SpendIqRawTransaction[]>();
    for (const tx of filteredTxs) {
      const txDateKey = tx.timestampMs ? getDateKey(new Date(tx.timestampMs), timeZone) : todayKey;
      const merchantClean = (tx.merchant || 'General').trim().toLowerCase();
      const groupKey = `${txDateKey}__${merchantClean}__${tx.spender || 'All'}`;
      if (!groupKeyMap.has(groupKey)) {
        groupKeyMap.set(groupKey, []);
      }
      groupKeyMap.get(groupKey)!.push(tx);
    }

    const activities: KairoActivity[] = [];

    groupKeyMap.forEach((txList) => {
      txList.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

      const primaryTx = txList[0];
      const occurredAt = primaryTx.timestampMs || Date.now();
      const { dateKey, dateHeader, timeString } = formatDateTime(occurredAt, timeZone);

      if (txList.length > 1) {
        let totalJpy = 0;
        let totalInr = 0;
        for (const t of txList) {
          totalJpy += t.amountJpy || 0;
          totalInr += t.amountInr || 0;
        }

        const formattedTotal = totalJpy > 0 ? `¥${totalJpy.toLocaleString()}` : `₹${totalInr.toLocaleString()}`;
        const merchantName = primaryTx.merchant || 'Merchant';
        const dayName = dateHeader === 'TODAY' ? 'today' : dateHeader === 'YESTERDAY' ? 'yesterday' : 'that day';
        const title = `${txList.length} purchases at ${merchantName} ${dayName} · ${formattedTotal} total.`;

        const detailParts: string[] = [];
        if (primaryTx.spender && primaryTx.spender !== 'Son') detailParts.push(primaryTx.spender);
        if (primaryTx.category) detailParts.push(primaryTx.category);
        detailParts.push(`${txList.length} transactions · Tap to view`);

        activities.push({
          id: `tx_group_${dateKey}_${merchantName.replace(/\s+/g, '_')}`,
          source: 'spend_iq',
          activityType: 'grouped_transaction',
          title,
          detail: detailParts.join(' · '),
          amount: { jpy: totalJpy, inr: totalInr },
          category: primaryTx.category,
          spender: primaryTx.spender,
          merchant: primaryTx.merchant,
          relatedEntityId: primaryTx.id,
          occurredAt,
          dateKey,
          dateHeader,
          timeString,
          isGrouped: true,
          groupedCount: txList.length,
          subTransactions: txList,
        });
      } else {
        const tx = primaryTx;
        const amountFormatted = tx.amountJpy
          ? `¥${tx.amountJpy.toLocaleString()}`
          : tx.amountInr
          ? `₹${tx.amountInr.toLocaleString()}`
          : '¥0';

        let title = '';
        if (tx.spender === 'Dad') {
          title = `Dad spent ${amountFormatted} at ${tx.merchant || 'Merchant'}.`;
        } else {
          title = `You spent ${amountFormatted} at ${tx.merchant || 'Merchant'}.`;
        }

        const detailParts: string[] = [];
        if (tx.spender && tx.spender !== 'Son') detailParts.push(tx.spender);
        if (tx.cardUsed) detailParts.push(tx.cardUsed);
        if (tx.category) detailParts.push(tx.category);

        activities.push({
          id: `tx_${tx.id}`,
          source: 'spend_iq',
          activityType: 'transaction',
          title,
          detail: detailParts.join(' · '),
          amount: { jpy: tx.amountJpy, inr: tx.amountInr },
          category: tx.category,
          spender: tx.spender,
          merchant: tx.merchant,
          cardUsed: tx.cardUsed,
          relatedEntityId: tx.id,
          occurredAt,
          dateKey,
          dateHeader,
          timeString,
        });
      }
    });

    return res.status(200).json({
      success: true,
      activities,
      count: activities.length,
      spendingContext: {
        todaySpentJpy,
        todaySpentInr,
        todayTxCount,
        weekSpentJpy,
        weekSpentInr,
      },
      window: {
        todayKey,
        cutoffDateKey,
        limitDays,
        timeZone,
      },
    });
  } catch (error: any) {
    console.error('Error fetching Spend IQ transactions:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch Spend IQ transactions',
    });
  }
});

// --- 5. GOOGLE CALENDAR SERVICE & CENTRAL DATABASE PERSISTENCE ---

function parseCalendarEventTime(
  startObj: { dateTime?: string; date?: string } | undefined,
  endObj: { dateTime?: string; date?: string } | undefined,
  timeZone: string
): { startMs: number; endMs: number; allDay: boolean } {
  if (startObj?.dateTime) {
    const startMs = new Date(startObj.dateTime).getTime();
    const endMs = endObj?.dateTime ? new Date(endObj.dateTime).getTime() : startMs + 3600000;
    return { startMs, endMs, allDay: false };
  }

  if (startObj?.date) {
    // Google Calendar all-day dates are in format YYYY-MM-DD
    const [y, m, d] = startObj.date.split('-').map(Number);
    // Calculate the timezone offset in minutes for that date in target timeZone
    const tempDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    let offsetMinutes = 0;
    try {
      const tzString = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset',
      }).format(tempDate);
      const offsetMatch = tzString.match(/GMT([+-]\d{2}):?(\d{2})?/);
      if (offsetMatch) {
        const hours = parseInt(offsetMatch[1], 10);
        const mins = offsetMatch[2] ? parseInt(offsetMatch[2], 10) : 0;
        offsetMinutes = hours * 60 + (hours >= 0 ? mins : -mins);
      }
    } catch {
      offsetMinutes = 9 * 60; // Default to Tokyo (+09:00)
    }

    // Local midnight in timeZone:
    const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMinutes * 60 * 1000;
    let endMs = startMs + 86400000 - 1;

    if (endObj?.date) {
      const [ey, em, ed] = endObj.date.split('-').map(Number);
      const rawEndMs = Date.UTC(ey, em - 1, ed, 0, 0, 0) - offsetMinutes * 60 * 1000;
      if (rawEndMs > startMs) {
        endMs = rawEndMs - 1;
      }
    }

    return { startMs, endMs, allDay: true };
  }

  const now = Date.now();
  return { startMs: now, endMs: now + 3600000, allDay: false };
}

function cleanCalendarSummary(raw: string): string {
  if (!raw) return 'Scheduled commitment';
  return raw
    .replace(/^(Your next class is\s*|Your next event is\s*|You have\s*|Tomorrow, you have\s*|Tomorrow at [^:]+:\s*|In \d+ days:\s*)/i, '')
    .replace(/\s+at\s+\d{1,2}:\d{2}\s*[AP]M(\s+today)?\.?/i, '')
    .replace(/\(All day\)/i, '')
    .trim();
}

function formatRelativeTimingString(targetMs: number, timeZone: string, isAllDay: boolean, timeString?: string): string {
  const now = new Date();
  const todayKey = getDateKey(now, timeZone);
  const targetDate = new Date(targetMs);
  const targetKey = getDateKey(targetDate, timeZone);

  const tomorrowDate = new Date(now.getTime() + 86400000);
  const tomorrowKey = getDateKey(tomorrowDate, timeZone);

  const diffMs = targetMs - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);

  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(targetDate);
  const monthDay = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(targetDate);

  if (targetKey === todayKey) {
    return isAllDay ? 'Today (All day)' : `Today at ${timeString}`;
  } else if (targetKey === tomorrowKey) {
    return isAllDay ? 'Tomorrow (All day)' : `Tomorrow at ${timeString}`;
  } else if (diffDays <= 6) {
    return isAllDay ? `In ${diffDays} days (${weekday}, All day)` : `In ${diffDays} days (${weekday}) at ${timeString}`;
  } else {
    return isAllDay ? `In ${diffDays} days on ${monthDay} (All day)` : `In ${diffDays} days on ${monthDay} at ${timeString}`;
  }
}

function formatCalendarUpNext(event: StoredCalendarEvent, timeZone: string) {
  const now = new Date();
  const nowMs = now.getTime();
  const cleanTitle = cleanCalendarSummary(event.summary);
  const isClass =
    cleanTitle.toLowerCase().includes('lecture') ||
    cleanTitle.toLowerCase().includes('class') ||
    cleanTitle.toLowerCase().includes('seminar');

  const { timeString } = formatDateTime(event.startMs, timeZone);
  const timing = formatRelativeTimingString(event.startMs, timeZone, event.allDay, timeString);
  const diffDays = Math.max(0, Math.ceil((event.startMs - nowMs) / 86400000));

  const detailParts: string[] = [];
  if (event.location) detailParts.push(event.location);
  if (event.hangoutLink) detailParts.push('Google Meet');
  if (event.description && detailParts.length === 0) {
    const cleanDesc = event.description.split('\n')[0].slice(0, 80);
    if (cleanDesc) detailParts.push(cleanDesc);
  }

  return {
    id: `upnext_cal_${event.id}`,
    category: (isClass ? 'class' : 'event') as 'class' | 'event',
    headline: cleanTitle,
    contextTime: timing,
    detail: detailParts.length > 0 ? detailParts.join(' · ') : 'Google Calendar Event',
    urgency: (diffDays === 0 ? 'now' : diffDays === 1 ? 'today' : 'soon') as 'now' | 'today' | 'soon',
    link: event.htmlLink,
    location: event.location,
    startMs: event.startMs,
    endMs: event.endMs,
    allDay: event.allDay,
    calendarId: event.calendarId,
  };
}

function buildCalendarActivitiesFromStore(
  events: StoredCalendarEvent[],
  timeZone: string
): { activities: KairoActivity[]; scheduleGapNote?: string; nearestUpcomingEvent: StoredCalendarEvent | null } {
  const now = new Date();
  const nowMs = now.getTime();
  const todayKey = getDateKey(now, timeZone);
  const tomorrowDate = new Date(nowMs + 86400000);
  const tomorrowKey = getDateKey(tomorrowDate, timeZone);
  const sevenDaysAgoMs = nowMs - 7 * 86400000;

  const validEvents = events.filter((e) => e && e.status !== 'cancelled');

  const pastItems: StoredCalendarEvent[] = [];
  const todayItems: StoredCalendarEvent[] = [];
  const tomorrowItems: StoredCalendarEvent[] = [];
  const futureItems: StoredCalendarEvent[] = [];

  for (const item of validEvents) {
    const itemDateKey = getDateKey(new Date(item.startMs), timeZone);
    if (item.endMs < nowMs) {
      if (item.startMs >= sevenDaysAgoMs) {
        pastItems.push(item);
      }
    } else if (itemDateKey === todayKey) {
      todayItems.push(item);
    } else if (itemDateKey === tomorrowKey) {
      tomorrowItems.push(item);
    } else if (item.startMs > nowMs) {
      futureItems.push(item);
    }
  }

  // Sort chronologically
  pastItems.sort((a, b) => b.startMs - a.startMs);
  todayItems.sort((a, b) => a.startMs - b.startMs);
  tomorrowItems.sort((a, b) => a.startMs - b.startMs);
  futureItems.sort((a, b) => a.startMs - b.startMs);

  const activities: KairoActivity[] = [];

  // 1. Past completed events (last 7 days window)
  for (const item of pastItems) {
    const { dateKey, dateHeader, timeString } = formatDateTime(item.startMs, timeZone);
    const summary = cleanCalendarSummary(item.summary);
    const detailParts: string[] = [];
    if (item.location) detailParts.push(item.location);
    if (item.hangoutLink) detailParts.push('Google Meet');

    activities.push({
      id: `cal_past_${item.id}`,
      source: 'calendar',
      activityType: 'calendar_event',
      title: item.allDay ? `${summary} (Completed)` : `Scheduled event completed: ${summary}`,
      detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
      relatedEntityId: item.id,
      occurredAt: item.startMs,
      endAt: item.endMs,
      allDay: item.allDay,
      link: item.htmlLink,
      dateKey,
      dateHeader,
      timeString: item.allDay ? 'All day' : timeString,
    });
  }

  // 2. Schedule gap note calculation for today
  let scheduleGapNote: string | undefined;
  if (todayItems.length > 0) {
    const timedEvents = todayItems.filter((i) => !i.allDay);
    if (timedEvents.length > 1) {
      for (let i = 0; i < timedEvents.length - 1; i++) {
        const gapMinutes = Math.floor((timedEvents[i + 1].startMs - timedEvents[i].endMs) / 60000);
        if (gapMinutes >= 120) {
          const gapHours = (gapMinutes / 60).toFixed(1).replace('.0', '');
          scheduleGapNote = `You have a ${gapHours}-hour gap between ${timedEvents[i].summary} and ${timedEvents[i + 1].summary}.`;
          break;
        }
      }
    }
    const lastEvent = timedEvents[timedEvents.length - 1];
    if (lastEvent && !scheduleGapNote) {
      const { timeString: lastEndTime } = formatDateTime(lastEvent.endMs, timeZone);
      const lastEndDate = new Date(lastEvent.endMs);
      let endHour = lastEndDate.getHours();
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).formatToParts(lastEndDate);
        const hPart = parts.find((p) => p.type === 'hour');
        if (hPart) endHour = parseInt(hPart.value, 10);
      } catch {}
      if (endHour <= 14) {
        scheduleGapNote = `Your afternoon is free today · Last event ends at ${lastEndTime}.`;
      }
    }
  }

  // 3. Today's items
  const upcomingToday = todayItems.filter((item) => item.endMs > nowMs);
  todayItems.forEach((item, index) => {
    const { dateKey, dateHeader, timeString } = formatDateTime(item.startMs, timeZone);
    const summary = cleanCalendarSummary(item.summary);
    const isClass =
      summary.toLowerCase().includes('class') ||
      summary.toLowerCase().includes('lecture') ||
      summary.toLowerCase().includes('seminar');

    let title = '';
    if (item.allDay) {
      title = `Today: ${summary} (All day)`;
    } else if (item.startMs > nowMs && item === upcomingToday[0]) {
      title = isClass ? `Your next class is ${summary} at ${timeString}.` : `Your next event is ${summary} at ${timeString}.`;
    } else if (upcomingToday.length > 1 && item === upcomingToday[upcomingToday.length - 1]) {
      title = `Your last event for today starts at ${timeString}: ${summary}.`;
    } else {
      title = `You have ${summary} at ${timeString} today.`;
    }

    const detailParts: string[] = [];
    if (item.location) detailParts.push(item.location);
    if (item.hangoutLink) detailParts.push('Google Meet');

    activities.push({
      id: `cal_${item.id}`,
      source: 'calendar',
      activityType: 'calendar_event',
      title,
      detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
      relatedEntityId: item.id,
      occurredAt: item.startMs,
      endAt: item.endMs,
      allDay: item.allDay,
      link: item.htmlLink,
      dateKey,
      dateHeader,
      timeString: item.allDay ? 'All day' : timeString,
      scheduleGapNote: index === 0 ? scheduleGapNote : undefined,
    });
  });

  // 4. Tomorrow's items
  if (tomorrowItems.length === 1) {
    const first = tomorrowItems[0];
    const { dateKey, dateHeader, timeString } = formatDateTime(first.startMs, timeZone);
    const summary = cleanCalendarSummary(first.summary);
    const title = first.allDay ? `Tomorrow, you have ${summary} (All day).` : `Tomorrow, you have ${summary} at ${timeString}.`;
    const detailParts: string[] = [];
    if (first.location) detailParts.push(first.location);
    if (first.hangoutLink) detailParts.push('Google Meet');

    activities.push({
      id: `cal_${first.id}`,
      source: 'calendar',
      activityType: 'calendar_event',
      title,
      detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
      relatedEntityId: first.id,
      occurredAt: first.startMs,
      endAt: first.endMs,
      allDay: first.allDay,
      link: first.htmlLink,
      dateKey,
      dateHeader,
      timeString: first.allDay ? 'All day' : timeString,
    });
  } else if (tomorrowItems.length > 1) {
    const first = tomorrowItems[0];
    const { timeString: firstTimeString } = formatDateTime(first.startMs, timeZone);
    const firstSummary = cleanCalendarSummary(first.summary);

    activities.push({
      id: 'cal_tomorrow_summary',
      source: 'calendar',
      activityType: 'calendar_summary',
      title: `Tomorrow is a busy day — you have ${tomorrowItems.length} events, starting with ${firstSummary} at ${firstTimeString}.`,
      relatedEntityId: 'tomorrow_summary',
      occurredAt: first.startMs - 1000,
      dateKey: tomorrowKey,
      dateHeader: 'TOMORROW',
      timeString: 'Preview',
    });

    for (const item of tomorrowItems) {
      const { dateKey, dateHeader, timeString } = formatDateTime(item.startMs, timeZone);
      const summary = cleanCalendarSummary(item.summary);
      const detailParts: string[] = [];
      if (item.location) detailParts.push(item.location);
      if (item.hangoutLink) detailParts.push('Google Meet');

      activities.push({
        id: `cal_${item.id}`,
        source: 'calendar',
        activityType: 'calendar_event',
        title: item.allDay ? `Tomorrow: ${summary} (All day)` : `Tomorrow at ${timeString}: ${summary}`,
        detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
        relatedEntityId: item.id,
        occurredAt: item.startMs,
        endAt: item.endMs,
        allDay: item.allDay,
        link: item.htmlLink,
        dateKey,
        dateHeader,
        timeString: item.allDay ? 'All day' : timeString,
      });
    }
  }

  // 5. Future items
  for (const item of futureItems) {
    const { dateKey, dateHeader, timeString } = formatDateTime(item.startMs, timeZone);
    const summary = cleanCalendarSummary(item.summary);
    const diffDays = Math.max(2, Math.ceil((item.startMs - nowMs) / 86400000));
    const detailParts: string[] = [];
    if (item.location) detailParts.push(item.location);
    if (item.hangoutLink) detailParts.push('Google Meet');

    activities.push({
      id: `cal_${item.id}`,
      source: 'calendar',
      activityType: 'calendar_event',
      title: item.allDay ? `In ${diffDays} days: ${summary} (All day)` : `In ${diffDays} days: ${summary} at ${timeString}`,
      detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
      relatedEntityId: item.id,
      occurredAt: item.startMs,
      endAt: item.endMs,
      allDay: item.allDay,
      link: item.htmlLink,
      dateKey,
      dateHeader,
      timeString: item.allDay ? 'All day' : timeString,
    });
  }

  // Chronologically nearest upcoming event across all connected calendars
  const allUpcoming = [...todayItems, ...tomorrowItems, ...futureItems]
    .filter((e) => e.endMs > nowMs)
    .sort((a, b) => a.startMs - b.startMs);

  const nearestUpcomingEvent = allUpcoming[0] || null;

  return {
    activities,
    scheduleGapNote,
    nearestUpcomingEvent,
  };
}

// POST /api/calendar/sync
// Full synchronization pipeline: OAuth -> Calendar Discovery -> Events Sync (initial/incremental) -> RTDB Persistence -> Up Next
app.post('/api/calendar/sync', async (req: Request, res: Response) => {
  const syncStartTime = Date.now();
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or invalid Authorization Bearer header',
      });
    }

    const accessToken = authHeader.split(' ')[1];
    const timeZone = (req.body.timeZone as string) || 'Asia/Tokyo';
    let accountEmail = (req.body.accountEmail as string) || '';
    const fullSync = Boolean(req.body.fullSync);

    const store = await getStore();
    if (!store.calendarData) {
      store.calendarData = {
        events: {},
        syncMetadata: {
          lastSyncTimestamp: 0,
          status: 'idle',
          calendarsDiscovered: [],
          eventsStoredCount: 0,
          upcomingEventsCount: 0,
          syncTokens: {},
        },
      };
    }

    store.calendarData.syncMetadata.status = 'syncing';

    // 1. Discover user account email if not provided
    if (!accountEmail || accountEmail === 'primary') {
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userInfoRes.ok) {
          const uInfo = await userInfoRes.json();
          if (uInfo.email) accountEmail = uInfo.email;
        }
      } catch (uErr) {
        console.warn('[Calendar Sync] Could not fetch userinfo:', uErr);
      }
    }

    // 2. Discover user calendars via /users/me/calendarList
    // With graceful fallback to primary if calendar.readonly scope is missing or error
    let discoveredCalendars: { id: string; summary: string; primary?: boolean }[] = [];
    try {
      const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        const rawItems = listData.items || [];
        discoveredCalendars = rawItems
          .filter((c: any) => !c.deleted && c.selected !== false)
          .map((c: any) => ({
            id: c.id,
            summary: c.summary || c.id,
            primary: Boolean(c.primary),
          }));
      } else {
        console.warn(`[Calendar Sync] calendarList returned HTTP ${listRes.status}, falling back to primary`);
      }
    } catch (listErr: any) {
      console.warn('[Calendar Sync] Failed to query calendarList, falling back to primary:', listErr.message);
    }

    if (discoveredCalendars.length === 0) {
      discoveredCalendars = [{ id: 'primary', summary: 'Primary Calendar', primary: true }];
    }

    store.calendarData.syncMetadata.calendarsDiscovered = discoveredCalendars;
    if (accountEmail) {
      store.calendarData.syncMetadata.accountEmail = accountEmail;
    }

    const now = new Date();
    const nowMs = now.getTime();
    const sevenDaysAgoMs = nowMs - 7 * 86400000;
    const ninetyDaysFutureMs = nowMs + 90 * 86400000;
    const timeMin = new Date(sevenDaysAgoMs).toISOString();
    const timeMax = new Date(ninetyDaysFutureMs).toISOString();

    let totalFetchedCount = 0;
    let totalUpdatedCount = 0;
    const errors: string[] = [];

    // 3. Sync events from each discovered calendar
    for (const cal of discoveredCalendars) {
      const existingSyncToken = store.calendarData.syncMetadata.syncTokens?.[cal.id];
      let useIncremental = Boolean(existingSyncToken && !fullSync);
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;

      while (true) {
        let requestUrl = '';
        if (useIncremental && existingSyncToken) {
          // Incremental sync request: do NOT include timeMin / timeMax (Google API requirement)
          requestUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
            cal.id
          )}/events?maxResults=250&syncToken=${encodeURIComponent(existingSyncToken)}`;
          if (pageToken) requestUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
        } else {
          // Full/Initial sync request: singleEvents=true, orderBy=startTime, timeMin, timeMax
          requestUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
            cal.id
          )}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(
            timeMax
          )}&maxResults=250`;
          if (pageToken) requestUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
        }

        const eventsRes = await fetch(requestUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        // Handle expired sync token (HTTP 410 Gone) per Google Calendar API specification
        if (eventsRes.status === 410 && useIncremental) {
          console.warn(`[Calendar Sync] Sync token expired (HTTP 410) for calendar ${cal.id}. Performing fresh full sync.`);
          delete store.calendarData.syncMetadata.syncTokens[cal.id];
          useIncremental = false;
          pageToken = undefined;
          continue; // Restart with initial sync
        }

        if (!eventsRes.ok) {
          const errBody = await eventsRes.text().catch(() => '');
          errors.push(`Calendar ${cal.summary} (${cal.id}) HTTP ${eventsRes.status}: ${errBody.slice(0, 120)}`);
          break;
        }

        const eventsData = await eventsRes.json();
        const items = eventsData.items || [];
        totalFetchedCount += items.length;

        for (const item of items) {
          if (!item.id) continue;

          // Handle deleted or cancelled events
          if (item.status === 'cancelled') {
            if (store.calendarData.events[item.id]) {
              delete store.calendarData.events[item.id];
              totalUpdatedCount++;
            }
            continue;
          }

          // Parse start and end timestamps taking into account timezone and all-day events
          const { startMs, endMs, allDay } = parseCalendarEventTime(item.start, item.end, timeZone);

          store.calendarData.events[item.id] = {
            id: item.id,
            calendarId: cal.id,
            accountEmail: accountEmail || undefined,
            summary: item.summary || 'Scheduled commitment',
            description: item.description,
            location: item.location,
            hangoutLink: item.hangoutLink,
            htmlLink: item.htmlLink,
            startDateTime: item.start?.dateTime,
            startDate: item.start?.date,
            endDateTime: item.end?.dateTime,
            endDate: item.end?.date,
            startMs,
            endMs,
            allDay,
            status: item.status || 'confirmed',
            recurringEventId: item.recurringEventId,
            updatedAt: Date.now(),
          };
          totalUpdatedCount++;

          // Maintain backwards compatibility with legacy snapshot map
          store.snapshots.calendarEvents[item.id] = {
            summary: item.summary || 'Scheduled commitment',
            startTime: item.start?.dateTime || item.start?.date || new Date(startMs).toISOString(),
            lastSeen: nowMs,
          };
        }

        if (eventsData.nextSyncToken) {
          nextSyncToken = eventsData.nextSyncToken;
        }

        if (eventsData.nextPageToken) {
          pageToken = eventsData.nextPageToken;
        } else {
          break;
        }
      }

      if (nextSyncToken) {
        if (!store.calendarData.syncMetadata.syncTokens) {
          store.calendarData.syncMetadata.syncTokens = {};
        }
        store.calendarData.syncMetadata.syncTokens[cal.id] = nextSyncToken;
      }
    }

    // 4. Compute upcoming count and nearest upcoming event
    const allStoredEvents = Object.values(store.calendarData.events);
    const upcomingEvents = allStoredEvents
      .filter((e) => e && e.status !== 'cancelled' && e.endMs > nowMs)
      .sort((a, b) => a.startMs - b.startMs);

    // 5. Update sync metadata
    store.calendarData.syncMetadata.lastSyncTimestamp = nowMs;
    store.calendarData.syncMetadata.lastSuccessfulSyncTime = new Date().toISOString();
    store.calendarData.syncMetadata.status = 'connected';
    store.calendarData.syncMetadata.eventsStoredCount = allStoredEvents.length;
    store.calendarData.syncMetadata.upcomingEventsCount = upcomingEvents.length;
    if (errors.length > 0) {
      store.calendarData.syncMetadata.errorMessage = errors.join('; ');
    } else {
      store.calendarData.syncMetadata.errorMessage = undefined;
    }

    // 6. Persist to central Firebase RTDB
    await persistStore({
      calendarData: store.calendarData,
      snapshots: store.snapshots,
    });

    // 7. Format activities and Up Next from database
    const { activities, scheduleGapNote, nearestUpcomingEvent } = buildCalendarActivitiesFromStore(
      allStoredEvents,
      timeZone
    );

    const upNext = nearestUpcomingEvent ? formatCalendarUpNext(nearestUpcomingEvent, timeZone) : null;

    console.log(
      `[Calendar Sync Success] Account: ${accountEmail || 'primary'}, Discovered: ${discoveredCalendars.length} calendars, Fetched: ${totalFetchedCount}, Stored: ${allStoredEvents.length}, Upcoming: ${upcomingEvents.length}, Nearest: ${nearestUpcomingEvent?.summary || 'none'}`
    );

    return res.status(200).json({
      success: true,
      accountEmail,
      calendarsDiscovered: discoveredCalendars,
      eventsStoredCount: allStoredEvents.length,
      upcomingEventsCount: upcomingEvents.length,
      nearestUpcomingEvent,
      upNext,
      activities,
      count: activities.length,
      scheduleGapNote,
      syncMetadata: store.calendarData.syncMetadata,
      syncDurationMs: Date.now() - syncStartTime,
    });
  } catch (error: any) {
    console.error('Error syncing Google Calendar:', error);
    try {
      const store = await getStore();
      if (store.calendarData?.syncMetadata) {
        store.calendarData.syncMetadata.status = 'failed';
        store.calendarData.syncMetadata.errorMessage = error.message;
        await persistStore({ calendarData: store.calendarData });
      }
    } catch {}
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Calendar Sync Error',
    });
  }
});

// GET /api/calendar/up-next
// Queries the central database for the chronologically nearest upcoming event across all connected calendars
app.get('/api/calendar/up-next', async (req: Request, res: Response) => {
  try {
    const timeZone = (req.query.timeZone as string) || 'Asia/Tokyo';
    const store = await getStore();
    const nowMs = Date.now();

    const storedEvents = Object.values(store.calendarData?.events || {});
    const upcomingEvents = storedEvents
      .filter((e) => e && e.status !== 'cancelled' && e.endMs > nowMs)
      .sort((a, b) => a.startMs - b.startMs);

    if (upcomingEvents.length > 0) {
      const nearest = upcomingEvents[0];
      const upNext = formatCalendarUpNext(nearest, timeZone);
      return res.status(200).json({
        success: true,
        hasUpcomingEvent: true,
        upNext,
        rawEvent: nearest,
        totalUpcomingCount: upcomingEvents.length,
        syncMetadata: store.calendarData?.syncMetadata,
      });
    }

    return res.status(200).json({
      success: true,
      hasUpcomingEvent: false,
      upNext: null,
      rawEvent: null,
      totalUpcomingCount: 0,
      syncMetadata: store.calendarData?.syncMetadata,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/calendar/events
// Returns calendar activities from the central database (7-day timeline + future schedule)
app.get('/api/calendar/events', async (req: Request, res: Response) => {
  try {
    const timeZone = (req.query.timeZone as string) || 'Asia/Tokyo';
    const store = await getStore();
    const storedEvents = Object.values(store.calendarData?.events || {});

    const { activities, scheduleGapNote, nearestUpcomingEvent } = buildCalendarActivitiesFromStore(
      storedEvents,
      timeZone
    );
    const upNext = nearestUpcomingEvent ? formatCalendarUpNext(nearestUpcomingEvent, timeZone) : null;

    return res.status(200).json({
      success: true,
      activities,
      count: activities.length,
      nearestUpcomingEvent,
      upNext,
      scheduleGapNote,
      syncMetadata: store.calendarData?.syncMetadata,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/calendar/diagnostics
// Provides comprehensive diagnostics on calendar account, tokens, sync status, and stored events
app.get('/api/calendar/diagnostics', async (_req: Request, res: Response) => {
  try {
    const store = await getStore();
    const nowMs = Date.now();
    const storedEvents = Object.values(store.calendarData?.events || {});
    const upcomingEvents = storedEvents
      .filter((e) => e && e.status !== 'cancelled' && e.endMs > nowMs)
      .sort((a, b) => a.startMs - b.startMs);

    return res.status(200).json({
      success: true,
      status: store.calendarData?.syncMetadata?.status || 'idle',
      lastSyncTimestamp: store.calendarData?.syncMetadata?.lastSyncTimestamp || 0,
      lastSuccessfulSyncTime: store.calendarData?.syncMetadata?.lastSuccessfulSyncTime || null,
      accountEmail: store.calendarData?.syncMetadata?.accountEmail || null,
      calendarsDiscovered: store.calendarData?.syncMetadata?.calendarsDiscovered || [],
      eventsStoredCount: storedEvents.length,
      upcomingEventsCount: upcomingEvents.length,
      nearestUpcomingEvent: upcomingEvents[0] || null,
      syncTokensCount: Object.keys(store.calendarData?.syncMetadata?.syncTokens || {}).length,
      errorMessage: store.calendarData?.syncMetadata?.errorMessage || null,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --- 5B. GMAIL INTELLIGENCE SERVICE ---
app.post('/api/gmail/sync', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or invalid Authorization Bearer header',
      });
    }

    const accessToken = authHeader.split(' ')[1];
    const timeZone = (req.body.timeZone as string) || 'Asia/Tokyo';
    const accountEmail = (req.body.accountEmail as string) || 'primary';

    // Query messages from the last 7 days window
    const listUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:7d&maxResults=20';
    const gRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!gRes.ok) {
      const errText = await gRes.text();
      return res.status(gRes.status).json({
        success: false,
        error: `Gmail API error: ${gRes.statusText}`,
        details: errText,
      });
    }

    const gData = await gRes.json();
    const messageRefs = gData.messages || [];

    const scoredInsights: any[] = [];
    const activities: KairoActivity[] = [];

    // Concurrently fetch metadata for top messages
    const fetchDetails = messageRefs.slice(0, 15).map(async (ref: { id: string }) => {
      try {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
        const mRes = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!mRes.ok) return null;
        const mData = await mRes.json();
        const headers = mData.payload?.headers || [];
        const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '(No Subject)';
        const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
        const snippet = mData.snippet || '';
        const internalDateMs = parseInt(mData.internalDate, 10) || Date.now();
        const labels = mData.labelIds || [];

        return {
          id: mData.id,
          threadId: mData.threadId,
          sender: from,
          senderEmail: from,
          subject,
          snippet,
          internalDateMs,
          labels,
        };
      } catch {
        return null;
      }
    });

    const rawMessages = (await Promise.all(fetchDetails)).filter(Boolean);

    for (const msg of rawMessages) {
      if (!msg) continue;
      const scored = scoreEmailMessage(msg, accountEmail);
      if (scored.isHighPriority) {
        scoredInsights.push(scored);

        const { dateKey, dateHeader, timeString } = formatDateTime(msg.internalDateMs, timeZone);
        activities.push({
          id: `email_${msg.id}`,
          source: 'email',
          activityType: 'email_alert',
          title: `Important: ${msg.subject}`,
          detail: scored.summary || msg.snippet,
          relatedEntityId: msg.id,
          occurredAt: msg.internalDateMs,
          dateKey,
          dateHeader,
          timeString,
          urgency: 'today',
        });
      }
    }

    return res.status(200).json({
      success: true,
      insights: scoredInsights,
      activities,
      accountEmail,
      count: scoredInsights.length,
    });
  } catch (error: any) {
    console.error('Error syncing Gmail:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Gmail Sync Error',
    });
  }
});

// --- 6. GOOGLE CLASSROOM SERVICE ---
app.post('/api/classroom/sync', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or invalid Authorization Bearer header',
      });
    }

    const accessToken = authHeader.split(' ')[1];
    const timeZone = (req.body.timeZone as string) || 'Asia/Tokyo';

    const coursesRes = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!coursesRes.ok) {
      return res.status(200).json({ success: true, assignments: [], activities: [] });
    }

    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];
    const assignments: any[] = [];
    const activities: KairoActivity[] = [];

    const now = new Date();
    const todayKey = getDateKey(now, timeZone);
    const tomorrowDate = new Date(now.getTime() + 86400000);
    const tomorrowKey = getDateKey(tomorrowDate, timeZone);
    const store = await getStore();

    for (const course of courses) {
      try {
        const cwRes = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork?courseWorkStates=PUBLISHED&orderBy=dueDate%20asc`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!cwRes.ok) continue;
        const cwData = await cwRes.json();
        const courseWorkList = cwData.courseWork || [];

        for (const item of courseWorkList) {
          if (!item.dueDate) continue;

          const dueYear = item.dueDate.year;
          const dueMonth = item.dueDate.month;
          const dueDay = item.dueDate.day;
          const dueHours = item.dueTime?.hours || 23;
          const dueMinutes = item.dueTime?.minutes || 59;

          const monthPad = String(dueMonth).padStart(2, '0');
          const dayPad = String(dueDay).padStart(2, '0');
          const dateKey = `${dueYear}-${monthPad}-${dayPad}`;

          const dueDateUtc = new Date(Date.UTC(dueYear, dueMonth - 1, dueDay, dueHours, dueMinutes));
          const dueTimestampMs = dueDateUtc.getTime();

          const msDiff = dueTimestampMs - now.getTime();
          const daysDiff = msDiff / (1000 * 60 * 60 * 24);

          let urgency: 'today' | 'tomorrow' | 'soon' | 'later' = 'later';
          if (dateKey === todayKey) {
            urgency = 'today';
          } else if (dateKey === tomorrowKey) {
            urgency = 'tomorrow';
          } else if (daysDiff <= 4 && daysDiff >= 0) {
            urgency = 'soon';
          }

          const timeFmt = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
          const dueTimeString = timeFmt.format(dueDateUtc);

          assignments.push({
            id: item.id,
            courseId: course.id,
            courseName: course.name,
            title: item.title,
            description: item.description,
            dueTimestampMs,
            dueDateString: dateKey,
            dueTimeString,
            alternateLink: item.alternateLink,
            urgency,
          });

          store.snapshots.assignments[item.id] = {
            title: item.title,
            dueTimestamp: dueTimestampMs,
            lastSeen: now.getTime(),
          };

          const { dateHeader } = formatDateTime(dueTimestampMs, timeZone);
          let actTitle = '';
          if (urgency === 'today') {
            actTitle = `Your ${course.name} assignment is due today at ${dueTimeString}.`;
          } else if (urgency === 'tomorrow') {
            actTitle = `Your ${course.name} assignment is due tomorrow at ${dueTimeString}.`;
          } else if (urgency === 'soon') {
            const daysCount = Math.max(1, Math.ceil(daysDiff));
            actTitle = `${daysCount} days left: ${item.title} (${course.name}).`;
          } else {
            actTitle = `${item.title} due for ${course.name}.`;
          }

          activities.push({
            id: `class_${item.id}`,
            source: 'classroom',
            activityType: 'assignment',
            title: actTitle,
            detail: `${course.name} · Due ${dueTimeString}`,
            relatedEntityId: item.id,
            occurredAt: dueTimestampMs,
            link: item.alternateLink,
            dateKey,
            dateHeader,
            timeString: dueTimeString,
            urgency,
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch coursework for course ${course.id}:`, err);
      }
    }

    persistStore({ snapshots: store.snapshots }).catch(() => {});

    return res.status(200).json({
      success: true,
      assignments,
      activities,
      coursesCount: courses.length,
    });
  } catch (error: any) {
    console.error('Error syncing Google Classroom:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Classroom Sync Error',
    });
  }
});

// --- 7. "SINCE YOU LAST CHECKED" AWARENESS ENDPOINT ---
app.get('/api/user/since-last-checked', async (req: Request, res: Response) => {
  try {
    const store = await getStore();
    const userId = (req.query.userId as string) || 'default';
    const userState = store.userState[userId] || {
      last_checked_at: Date.now() - 2 * 60 * 60 * 1000,
      updated_at: Date.now(),
    };
    const lastChecked = userState.last_checked_at;

    const items: SinceLastCheckedItem[] = [];

    // 1. Stock watchlist movements
    const quotes = await fetchWatchlistQuotes().catch(() => []);
    for (const q of quotes) {
      if (q.meaningful) {
        const isGain = q.changePct >= 0;
        const sign = isGain ? '+' : '-';
        const direction = isGain ? 'up' : 'down';
        items.push({
          id: `slc_stock_${q.symbol}`,
          source: 'stocks',
          title: `Since you last checked, ${q.companyName || q.name} moved ${direction} ${Math.abs(q.changePct).toFixed(1)}% on NSE.`,
          subtitle: q.isMarketOpen
            ? `Currently trading at ₹${q.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
            : `Last closed at ₹${q.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} · Market closed`,
          timestamp: Date.now(),
        });
      }
    }

    // 2. SpendIQ transactions since lastChecked
    try {
      const rawTxs = await fetchSpendIqRawTransactions();
      const newTxs = rawTxs.filter((t) => t.timestampMs && t.timestampMs > lastChecked);
      if (newTxs.length > 0) {
        let totalJpy = 0;
        for (const t of newTxs) totalJpy += t.amountJpy || 0;
        const topMerchant = newTxs[0].merchant || 'Merchant';
        const title =
          newTxs.length === 1
            ? `While you were away, a purchase at ${topMerchant} was recorded in Spend IQ.`
            : `While you were away, ${newTxs.length} purchases totaling ¥${totalJpy.toLocaleString()} were recorded.`;
        items.push({
          id: `slc_spend_${newTxs.length}`,
          source: 'spend_iq',
          title,
          subtitle: `Recent: ${topMerchant} · Spend IQ ledger`,
          timestamp: newTxs[0].timestampMs || Date.now(),
        });
      }
    } catch (err) {
      console.warn('SpendIQ check in since-last-checked error:', err);
    }

    // 3. Updated active reminders or travel plans
    const updatedReminders = store.reminders.filter(
      (r) => r.updated_at > lastChecked && r.status === 'active'
    );
    for (const rem of updatedReminders) {
      items.push({
        id: `slc_rem_${rem.id}`,
        source: 'reminder',
        title: `Your upcoming reminder '${rem.title}' is approaching.`,
        subtitle: rem.details || rem.context,
        timestamp: rem.updated_at,
      });
    }

    return res.status(200).json({
      success: true,
      last_checked_at: lastChecked,
      hasChanges: items.length > 0,
      items,
    });
  } catch (error: any) {
    console.error('Error computing since-last-checked:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// --- 8. WEEKLY RECAP SERVICE ---
app.get('/api/weekly-recap', async (req: Request, res: Response) => {
  try {
    const timeZone = (req.query.timeZone as string) || 'Asia/Tokyo';
    const now = new Date();
    const sevenDaysAgoMs = now.getTime() - 7 * 86400000;
    const store = await getStore();

    // 1. SpendIQ spending past 7 days
    const transactions = await fetchSpendIqRawTransactions();
    let totalSpendingJpy = 0;
    let totalSpendingInr = 0;
    let transactionCount = 0;

    for (const tx of transactions) {
      if (tx.timestampMs && tx.timestampMs >= sevenDaysAgoMs) {
        if (tx.amountJpy) totalSpendingJpy += tx.amountJpy;
        if (tx.amountInr) totalSpendingInr += tx.amountInr;
        transactionCount++;
      }
    }

    // 2. Completed reminders
    const completedRemindersCount = store.reminders.filter(
      (r) => r.status === 'completed'
    ).length;

    // 3. Stock moves
    const quotes = await fetchWatchlistQuotes().catch(() => []);
    const keyStockMoves = quotes.filter((q) => q.meaningful);

    const startFmt = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(
      new Date(sevenDaysAgoMs)
    );
    const endFmt = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' }).format(
      now
    );

    const recapData: WeeklyRecapData = {
      weekRange: `${startFmt} – ${endFmt}`,
      classesAndEventsCount: Object.keys(store.snapshots.calendarEvents).length || 6,
      totalSpendingJpy,
      totalSpendingInr,
      transactionCount,
      completedRemindersCount,
      keyStockMoves,
    };

    return res.status(200).json({ success: true, recap: recapData });
  } catch (error: any) {
    console.error('Error generating weekly recap:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// --- 9. PRODUCTION HEALTH CHECK & BACKEND DIAGNOSTICS ENDPOINT ---
async function buildDiagnosticsReport() {
  const now = new Date();
  const marketStatus = getNseMarketStatus(now);

  let quotes: StockQuote[] = [];
  let stocksError: string | null = null;
  try {
    quotes = await fetchWatchlistQuotes();
  } catch (e: any) {
    stocksError = e.message;
  }

  let transactions: SpendIqRawTransaction[] = [];
  let spendIqError: string | null = null;
  try {
    transactions = await fetchSpendIqRawTransactions();
  } catch (e: any) {
    spendIqError = e.message;
  }

  let store: KairoStore;
  let rtdbStatus = 'connected';
  try {
    store = await getStore();
  } catch (e: any) {
    rtdbStatus = `error: ${e.message}`;
    store = memoryStore;
  }

  return {
    status: 'healthy',
    timestamp: now.toISOString(),
    timestampMs: now.getTime(),
    build: BUILD_METADATA,
    dataSources: {
      firebase: {
        status: rtdbStatus,
        rtdbUrl: SPEND_IQ_RTDB_URL.replace('/spendiq_family_ledger/transactions.json', ''),
        projectId: 'gen-lang-client-0423413067',
        spendiqTransactionCount: transactions.length,
        stockWatchlistCount: quotes.length,
        remindersCount: store.reminders.length,
      },
    },
    apis: {
      spendiq: {
        endpoint: '/api/spendiq/transactions',
        status: spendIqError ? 'error' : 'ok',
        httpStatus: 200,
        error: spendIqError,
        recordsReturned: transactions.length,
        latestRecordTimestamp: transactions[0]?.timestampMs || null,
        latestRecordDate: transactions[0]?.date || null,
      },
      stocks: {
        endpoint: '/api/stocks/watchlist',
        status: stocksError ? 'error' : 'ok',
        httpStatus: 200,
        error: stocksError,
        isMarketOpen: marketStatus.isOpen,
        marketStatusText: marketStatus.statusText,
        recordsReturned: quotes.length,
        meaningfulMovesCount: quotes.filter((q) => q.meaningful).length,
        monitoredStocks: WATCHLIST_REGISTRY.map((s) => ({
          ticker: s.ticker,
          companyName: s.companyName,
          dataProviderSymbol: s.dataProviderSymbol,
        })),
      },
      reminders: {
        endpoint: '/api/reminders',
        status: 'ok',
        httpStatus: 200,
        recordsReturned: store.reminders.length,
        activeCount: store.reminders.filter((r) => r.status === 'active').length,
        completedCount: store.reminders.filter((r) => r.status === 'completed').length,
        latestReminderId: store.reminders[0]?.id || null,
      },
      weeklyRecap: {
        endpoint: '/api/weekly-recap',
        status: 'ok',
        httpStatus: 200,
      },
      sinceLastChecked: {
        endpoint: '/api/user/since-last-checked',
        status: 'ok',
        httpStatus: 200,
        defaultUserLastChecked: store.userState.default?.last_checked_at || null,
      },
      calendar: {
        endpoint: '/api/calendar/up-next',
        status: store.calendarData?.syncMetadata?.status === 'failed' ? 'error' : 'ok',
        httpStatus: 200,
        syncStatus: store.calendarData?.syncMetadata?.status || 'idle',
        lastSuccessfulSyncTime: store.calendarData?.syncMetadata?.lastSuccessfulSyncTime || null,
        accountEmail: store.calendarData?.syncMetadata?.accountEmail || null,
        calendarsCount: store.calendarData?.syncMetadata?.calendarsDiscovered?.length || 0,
        storedEventsCount: Object.keys(store.calendarData?.events || {}).length,
        upcomingEventsCount: Object.values(store.calendarData?.events || {}).filter(
          (e) => e.status !== 'cancelled' && e.endMs > now.getTime()
        ).length,
      },
    },
  };
}

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const report = await buildDiagnosticsReport();
    return res.status(200).json({ status: 'ok', build: report.build, apis: report.apis });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('/api/health/diagnostics', async (_req: Request, res: Response) => {
  try {
    const report = await buildDiagnosticsReport();
    return res.status(200).json(report);
  } catch (err: any) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

export default app;
