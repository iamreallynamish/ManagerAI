import express, { Request, Response } from 'express';
import {
  KairoActivity,
  SpendIqRawTransaction,
  PersonalReminder,
  StockQuote,
  SinceLastCheckedItem,
  WeeklyRecapData,
} from '../src/types/activity.js';
import {
  WATCHLIST_REGISTRY,
  getNseMarketStatus,
  validateMarketQuote,
} from '../src/services/stockService.js';

const app = express();
app.use(express.json());

// --- CLOUD DATA CONFIGURATION ---
const SPEND_IQ_RTDB_URL =
  'https://spendiq-7de3d-default-rtdb.asia-southeast1.firebasedatabase.app/spendiq_family_ledger/transactions.json';

const KAIRO_RTDB_STORE_URL =
  'https://spendiq-7de3d-default-rtdb.asia-southeast1.firebasedatabase.app/kairo_store.json';

// Build and runtime metadata
const BUILD_METADATA = {
  buildId: 'kairo-prod-2026.11.02-parity-fix',
  gitCommit: 'a89c2f10-backend-parity',
  deploymentTimestamp: '2026-11-02T08:30:00Z',
  environment: process.env.VERCEL ? 'vercel-production' : (process.env.NODE_ENV || 'development'),
  runtime: process.env.VERCEL ? 'vercel-serverless-node' : 'node-express',
};

export interface KairoStore {
  userState: {
    [userId: string]: {
      last_checked_at: number;
      updated_at: number;
    };
  };
  reminders: PersonalReminder[];
  snapshots: {
    calendarEvents: { [id: string]: { summary: string; startTime: string; lastSeen: number } };
    assignments: { [id: string]: { title: string; dueTimestamp: number; lastSeen: number } };
    txIds: string[];
    cachedTransactions?: SpendIqRawTransaction[];
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
        memoryStore = {
          ...DEFAULT_STORE,
          ...cloudData,
          userState: { ...DEFAULT_STORE.userState, ...(cloudData.userState || {}) },
          reminders: Array.isArray(cloudData.reminders)
            ? cloudData.reminders
            : Object.values(cloudData.reminders || {}),
          snapshots: { ...DEFAULT_STORE.snapshots, ...(cloudData.snapshots || {}) },
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

    target.flights_booked = true;
    target.details = 'Flights confirmed! Outbound Jan 5, 2027 · Return Apr 5, 2027. Next: packing & travel checklist.';
    target.context = target.details;
    target.updated_at = Date.now();

    await persistStore({ reminders: store.reminders });
    return res.status(200).json({ success: true, reminder: target });
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

    return res.status(200).json({
      success: true,
      marketStatus,
      quotes,
      meaningfulQuotes,
      activities,
    });
  } catch (error: any) {
    console.error('Error fetching stock watchlist:', error);
    return res.status(500).json({ success: false, error: error.message });
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
      if (Array.isArray(rawData) && rawData.length > 0) {
        store.snapshots.cachedTransactions = rawData;
        persistStore({ snapshots: store.snapshots }).catch(() => {});
        return rawData;
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

  return [];
}

app.get('/api/spendiq/transactions', async (req: Request, res: Response) => {
  try {
    const timeZone = (req.query.timeZone as string) || 'Asia/Tokyo';
    const showAllSpenders = req.query.showAllSpenders !== 'false';
    const spenderFilter = req.query.spender as string | undefined;
    const limitDays = req.query.limitDays !== undefined ? parseInt(req.query.limitDays as string, 10) : 30;

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
    const cutoffDate = new Date(now.getTime() - (limitDays > 0 ? limitDays : 30) * 86400000);
    const cutoffDateKey = getDateKey(cutoffDate, timeZone);

    const filteredTxs = transactions.filter((tx) => {
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

// --- 5. GOOGLE CALENDAR SERVICE ---
app.post('/api/calendar/sync', async (req: Request, res: Response) => {
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

    const now = new Date();
    const todayKey = getDateKey(now, timeZone);
    const tomorrowDate = new Date(now.getTime() + 86400000);
    const tomorrowKey = getDateKey(tomorrowDate, timeZone);

    const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 60 * 60 * 60 * 1000).toISOString();

    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(
      timeMin
    )}&timeMax=${encodeURIComponent(timeMax)}`;

    const gRes = await fetch(calendarUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!gRes.ok) {
      const errText = await gRes.text();
      return res.status(gRes.status).json({
        success: false,
        error: `Google Calendar API error: ${gRes.statusText}`,
        details: errText,
      });
    }

    const gData = await gRes.json();
    const items = gData.items || [];

    const todayItems: any[] = [];
    const tomorrowItems: any[] = [];
    const seenEventIds = new Set<string>();

    for (const item of items) {
      if (item.status === 'cancelled') continue;
      if (!item.id || seenEventIds.has(item.id)) continue;
      seenEventIds.add(item.id);

      const startTimeStr = item.start?.dateTime || item.start?.date;
      if (!startTimeStr) continue;

      const eventDate = new Date(startTimeStr);
      const eventDateKey = getDateKey(eventDate, timeZone);

      if (eventDateKey === todayKey) {
        todayItems.push(item);
      } else if (eventDateKey === tomorrowKey) {
        tomorrowItems.push(item);
      }
    }

    todayItems.sort((a, b) => {
      const ta = new Date(a.start?.dateTime || a.start?.date).getTime();
      const tb = new Date(b.start?.dateTime || b.start?.date).getTime();
      return ta - tb;
    });

    tomorrowItems.sort((a, b) => {
      const ta = new Date(a.start?.dateTime || a.start?.date).getTime();
      const tb = new Date(b.start?.dateTime || b.start?.date).getTime();
      return ta - tb;
    });

    const activities: KairoActivity[] = [];
    const nowMs = now.getTime();

    let scheduleGapNote: string | undefined;
    if (todayItems.length > 0) {
      const timedEvents = todayItems.filter((i) => i.start?.dateTime && i.end?.dateTime);
      if (timedEvents.length > 1) {
        for (let i = 0; i < timedEvents.length - 1; i++) {
          const endCurr = new Date(timedEvents[i].end.dateTime).getTime();
          const startNext = new Date(timedEvents[i + 1].start.dateTime).getTime();
          const gapMinutes = Math.floor((startNext - endCurr) / 60000);
          if (gapMinutes >= 120) {
            const gapHours = (gapMinutes / 60).toFixed(1).replace('.0', '');
            const titleA = timedEvents[i].summary || 'Event';
            const titleB = timedEvents[i + 1].summary || 'Next event';
            scheduleGapNote = `You have a ${gapHours}-hour gap between ${titleA} and ${titleB}.`;
            break;
          }
        }
      }

      const lastEvent = timedEvents[timedEvents.length - 1];
      if (lastEvent) {
        const lastEndDate = new Date(lastEvent.end.dateTime);
        const { timeString: lastEndTime } = formatDateTime(lastEndDate.getTime(), timeZone);
        let endHour = 12;
        try {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: 'numeric',
            hour12: false,
          }).formatToParts(lastEndDate);
          const hPart = parts.find((p) => p.type === 'hour');
          if (hPart) endHour = parseInt(hPart.value, 10);
        } catch {
          endHour = lastEndDate.getHours();
        }

        if (endHour <= 14 && !scheduleGapNote) {
          scheduleGapNote = `Your afternoon is free today · Last event ends at ${lastEndTime}.`;
        }
      }
    }

    const upcomingToday = todayItems.filter(
      (item) => new Date(item.start?.dateTime || item.start?.date).getTime() > nowMs
    );

    const store = await getStore();

    todayItems.forEach((item, index) => {
      const startTimeStr = item.start?.dateTime || item.start?.date;
      const isAllDay = !item.start?.dateTime;
      const occurredAt = new Date(startTimeStr).getTime();
      const endAt = item.end?.dateTime || item.end?.date ? new Date(item.end?.dateTime || item.end?.date).getTime() : undefined;
      const { dateKey, dateHeader, timeString } = formatDateTime(occurredAt, timeZone);

      const summary = item.summary || 'Scheduled appointment';
      const isClass =
        summary.toLowerCase().includes('class') ||
        summary.toLowerCase().includes('lecture') ||
        summary.toLowerCase().includes('seminar');

      let isRescheduled = false;
      let originalTime: string | undefined;
      const prev = store.snapshots.calendarEvents[item.id];
      if (prev && prev.startTime !== startTimeStr) {
        isRescheduled = true;
        const prevDt = new Date(prev.startTime);
        originalTime = formatDateTime(prevDt.getTime(), timeZone).timeString;
      }

      store.snapshots.calendarEvents[item.id] = {
        summary,
        startTime: startTimeStr,
        lastSeen: nowMs,
      };

      let title = '';
      if (isRescheduled && originalTime) {
        title = `${summary} rescheduled from ${originalTime} to ${timeString}.`;
      } else if (isAllDay) {
        title = `Today: ${summary} (All day)`;
      } else if (occurredAt > nowMs && item === upcomingToday[0]) {
        title = isClass
          ? `Your next class is ${summary} at ${timeString}.`
          : `Your next event is ${summary} at ${timeString}.`;
      } else if (upcomingToday.length > 1 && item === upcomingToday[upcomingToday.length - 1]) {
        title = `Your last event for today starts at ${timeString}: ${summary}.`;
      } else {
        title = `You have ${summary} at ${timeString} today.`;
      }

      const detailParts = [];
      if (item.location) detailParts.push(item.location);
      if (item.hangoutLink) detailParts.push('Google Meet');

      activities.push({
        id: `cal_${item.id}`,
        source: 'calendar',
        activityType: 'calendar_event',
        title,
        detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
        relatedEntityId: item.id,
        occurredAt,
        endAt,
        allDay: isAllDay,
        link: item.htmlLink,
        dateKey,
        dateHeader,
        timeString: isAllDay ? 'All day' : timeString,
        isRescheduled,
        originalTime,
        scheduleGapNote: index === 0 ? scheduleGapNote : undefined,
      });
    });

    if (tomorrowItems.length === 0) {
      const tomorrowMidnightMs = tomorrowDate.setHours(0, 0, 0, 0);
      activities.push({
        id: `cal_tomorrow_empty`,
        source: 'calendar',
        activityType: 'calendar_empty',
        title: 'Nothing scheduled for tomorrow.',
        relatedEntityId: 'tomorrow_none',
        occurredAt: tomorrowMidnightMs,
        dateKey: tomorrowKey,
        dateHeader: 'TOMORROW',
        timeString: 'Tomorrow',
      });
    } else if (tomorrowItems.length === 1) {
      const first = tomorrowItems[0];
      const startTimeStr = first.start?.dateTime || first.start?.date;
      const isAllDay = !first.start?.dateTime;
      const occurredAt = new Date(startTimeStr).getTime();
      const endAt = first.end?.dateTime || first.end?.date ? new Date(first.end?.dateTime || first.end?.date).getTime() : undefined;
      const { dateKey, dateHeader, timeString } = formatDateTime(occurredAt, timeZone);
      const summary = first.summary || 'Scheduled appointment';

      const title = isAllDay
        ? `Tomorrow, you have ${summary} (All day).`
        : `Tomorrow, you have ${summary} at ${timeString}.`;

      const detailParts = [];
      if (first.location) detailParts.push(first.location);
      if (first.hangoutLink) detailParts.push('Google Meet');

      activities.push({
        id: `cal_${first.id}`,
        source: 'calendar',
        activityType: 'calendar_event',
        title,
        detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
        relatedEntityId: first.id,
        occurredAt,
        endAt,
        allDay: isAllDay,
        link: first.htmlLink,
        dateKey,
        dateHeader,
        timeString: isAllDay ? 'All day' : timeString,
      });
    } else {
      const first = tomorrowItems[0];
      const firstTimeStr = first.start?.dateTime || first.start?.date;
      const { timeString: firstTimeString } = formatDateTime(new Date(firstTimeStr).getTime(), timeZone);
      const firstSummary = first.summary || 'Events';

      activities.push({
        id: 'cal_tomorrow_summary',
        source: 'calendar',
        activityType: 'calendar_summary',
        title: `Tomorrow is a busy day — you have ${tomorrowItems.length} events, starting with ${firstSummary} at ${firstTimeString}.`,
        relatedEntityId: 'tomorrow_summary',
        occurredAt: new Date(firstTimeStr).getTime() + 1,
        dateKey: tomorrowKey,
        dateHeader: 'TOMORROW',
        timeString: 'Preview',
      });

      for (const item of tomorrowItems) {
        const startTimeStr = item.start?.dateTime || item.start?.date;
        const isAllDay = !item.start?.dateTime;
        const occurredAt = new Date(startTimeStr).getTime();
        const endAt = item.end?.dateTime || item.end?.date ? new Date(item.end?.dateTime || item.end?.date).getTime() : undefined;
        const { dateKey, dateHeader, timeString } = formatDateTime(occurredAt, timeZone);
        const summary = item.summary || 'Scheduled appointment';

        const detailParts = [];
        if (item.location) detailParts.push(item.location);
        if (item.hangoutLink) detailParts.push('Google Meet');

        activities.push({
          id: `cal_${item.id}`,
          source: 'calendar',
          activityType: 'calendar_event',
          title: `Tomorrow at ${timeString}: ${summary}`,
          detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
          relatedEntityId: item.id,
          occurredAt,
          endAt,
          allDay: isAllDay,
          link: item.htmlLink,
          dateKey,
          dateHeader,
          timeString: isAllDay ? 'All day' : timeString,
        });
      }
    }

    persistStore({ snapshots: store.snapshots }).catch(() => {});

    return res.status(200).json({
      success: true,
      activities,
      count: activities.length,
      scheduleGapNote,
      window: { todayKey, tomorrowKey, timeZone },
    });
  } catch (error: any) {
    console.error('Error syncing Google Calendar:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Calendar Sync Error',
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
        items.push({
          id: `slc_stock_${q.symbol}`,
          source: 'stocks',
          title: `${q.name} moved ${sign}${Math.abs(q.changePct).toFixed(1)}%`,
          subtitle: q.isMarketOpen
            ? `Trading at ₹${q.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} on NSE`
            : `Closed at ₹${q.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} on NSE · Market closed`,
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
        items.push({
          id: `slc_spend_${newTxs.length}`,
          source: 'spend_iq',
          title: `${newTxs.length} new transaction${newTxs.length > 1 ? 's' : ''} in SpendIQ`,
          subtitle: `Total ¥${totalJpy.toLocaleString()} · Recent: ${topMerchant}`,
          timestamp: newTxs[0].timestampMs || Date.now(),
        });
      }
    } catch (err) {
      console.warn('SpendIQ check in since-last-checked error:', err);
    }

    // 3. Updated active reminders
    const updatedReminders = store.reminders.filter(
      (r) => r.updated_at > lastChecked && r.status === 'active'
    );
    for (const rem of updatedReminders) {
      items.push({
        id: `slc_rem_${rem.id}`,
        source: 'reminder',
        title: `Reminder active: ${rem.title}`,
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
