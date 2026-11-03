import spendiqFallback from '../data/spendiq_fallback.json';
import {
  KairoActivity,
  SpendIqRawTransaction,
  ClassroomAssignment,
  StockQuote,
  SinceLastCheckedItem,
  WeeklyRecapData,
  PersonalReminder,
  UserState,
  ReminderStatus,
  PortfolioHolding,
} from '../types/activity';
import { ScoredEmailInsight } from './emailIntelligence';

export interface FetchTransactionsOptions {
  timeZone?: string;
  showAllSpenders?: boolean;
  spender?: string;
  limitDays?: number;
}

export interface SpendIqFetchResult {
  activities: KairoActivity[];
  spendingContext?: {
    todaySpentJpy: number;
    todaySpentInr: number;
    todayTxCount: number;
    weekSpentJpy: number;
    weekSpentInr: number;
  };
}

const LOCAL_SPENDIQ_CACHE_KEY = 'kairo_cached_spendiq';
const DIRECT_RTDB_URL =
  'https://spendiq-7de3d-default-rtdb.asia-southeast1.firebasedatabase.app/spendiq_family_ledger/transactions.json';

function formatRawTransactionsToSpendIqResult(
  rawList: SpendIqRawTransaction[],
  options: FetchTransactionsOptions
): SpendIqFetchResult {
  const timeZone = options.timeZone || 'Asia/Tokyo';
  const showAllSpenders = options.showAllSpenders !== false;
  const spenderFilter = options.spender;

  let filtered = rawList.filter((tx) => {
    if (!tx || !tx.id) return false;
    if (spenderFilter) return tx.spender === spenderFilter;
    if (!showAllSpenders) return tx.spender === 'Son';
    return true;
  });

  if (filtered.length === 0 && rawList.length > 0) {
    filtered = rawList.slice(0, 30);
  }

  let todaySpentJpy = 0;
  let todaySpentInr = 0;
  let todayTxCount = 0;
  let weekSpentJpy = 0;
  let weekSpentInr = 0;

  const groupMap = new Map<string, SpendIqRawTransaction[]>();
  for (const tx of filtered) {
    if (tx.amountJpy) weekSpentJpy += tx.amountJpy;
    if (tx.amountInr) weekSpentInr += tx.amountInr;

    const d = tx.timestampMs ? new Date(tx.timestampMs) : new Date();
    const dateKey = d.toISOString().split('T')[0];
    const merchantClean = (tx.merchant || 'General').trim().toLowerCase();
    const groupKey = `${dateKey}__${merchantClean}__${tx.spender || 'All'}`;
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
    groupMap.get(groupKey)!.push(tx);
  }

  const activities: KairoActivity[] = [];
  groupMap.forEach((txList) => {
    txList.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
    const primary = txList[0];
    const occurredAt = primary.timestampMs || Date.now();
    const d = new Date(occurredAt);
    const dateKey = d.toISOString().split('T')[0];
    const dateHeader = d
      .toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' })
      .toUpperCase();
    const timeString = d.toLocaleTimeString('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (txList.length > 1) {
      let totalJpy = 0;
      let totalInr = 0;
      for (const t of txList) {
        totalJpy += t.amountJpy || 0;
        totalInr += t.amountInr || 0;
      }
      const formattedTotal = totalJpy > 0 ? `¥${totalJpy.toLocaleString()}` : `₹${totalInr.toLocaleString()}`;
      activities.push({
        id: `tx_group_${dateKey}_${(primary.merchant || 'Merchant').replace(/\s+/g, '_')}`,
        source: 'spend_iq',
        activityType: 'grouped_transaction',
        title: `${txList.length} purchases at ${primary.merchant || 'Merchant'} · ${formattedTotal} total.`,
        detail: `${primary.category || 'Ledger'} · ${txList.length} transactions · Tap to view`,
        amount: { jpy: totalJpy, inr: totalInr },
        category: primary.category,
        spender: primary.spender,
        merchant: primary.merchant,
        relatedEntityId: primary.id,
        occurredAt,
        dateKey,
        dateHeader,
        timeString,
        isGrouped: true,
        groupedCount: txList.length,
        subTransactions: txList,
      });
    } else {
      const amountFormatted = primary.amountJpy
        ? `¥${primary.amountJpy.toLocaleString()}`
        : primary.amountInr
        ? `₹${primary.amountInr.toLocaleString()}`
        : '¥0';
      const title =
        primary.spender === 'Dad'
          ? `Dad spent ${amountFormatted} at ${primary.merchant || 'Merchant'}.`
          : `You spent ${amountFormatted} at ${primary.merchant || 'Merchant'}.`;
      activities.push({
        id: `tx_${primary.id}`,
        source: 'spend_iq',
        activityType: 'transaction',
        title,
        detail: [primary.spender !== 'Son' ? primary.spender : null, primary.cardUsed, primary.category]
          .filter(Boolean)
          .join(' · '),
        amount: { jpy: primary.amountJpy, inr: primary.amountInr },
        category: primary.category,
        spender: primary.spender,
        merchant: primary.merchant,
        cardUsed: primary.cardUsed,
        relatedEntityId: primary.id,
        occurredAt,
        dateKey,
        dateHeader,
        timeString,
      });
    }
  });

  return {
    activities,
    spendingContext: {
      todaySpentJpy,
      todaySpentInr,
      todayTxCount,
      weekSpentJpy,
      weekSpentInr,
    },
  };
}

export async function fetchSpendIqActivities(
  options: FetchTransactionsOptions = {}
): Promise<SpendIqFetchResult> {
  const params = new URLSearchParams();
  if (options.timeZone) params.set('timeZone', options.timeZone);
  if (options.showAllSpenders !== undefined) params.set('showAllSpenders', String(options.showAllSpenders));
  if (options.spender) params.set('spender', options.spender);
  if (options.limitDays !== undefined) params.set('limitDays', String(options.limitDays));
  else params.set('limitDays', '90');

  try {
    const res = await fetch(`/api/spendiq/transactions?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.activities) && data.activities.length > 0) {
        const result: SpendIqFetchResult = {
          activities: data.activities,
          spendingContext: data.spendingContext,
        };
        try {
          localStorage.setItem(LOCAL_SPENDIQ_CACHE_KEY, JSON.stringify(result));
        } catch {}
        return result;
      }
    }
  } catch (err: any) {
    console.warn('Backend /api/spendiq/transactions fetch failed:', err.message);
  }

  // Fallback 1: Try direct RTDB fetch from client
  try {
    const directRes = await fetch(DIRECT_RTDB_URL);
    if (directRes.ok) {
      const rawData = await directRes.json();
      const list: SpendIqRawTransaction[] = Array.isArray(rawData)
        ? rawData.filter(Boolean)
        : rawData && typeof rawData === 'object'
        ? (Object.values(rawData).filter(Boolean) as SpendIqRawTransaction[])
        : [];
      if (list.length > 0) {
        const formatted = formatRawTransactionsToSpendIqResult(list, options);
        try {
          localStorage.setItem(LOCAL_SPENDIQ_CACHE_KEY, JSON.stringify(formatted));
        } catch {}
        return formatted;
      }
    }
  } catch (err: any) {
    console.warn('Direct RTDB fetch failed:', err.message);
  }

  // Fallback 2: Check localStorage cache
  try {
    const cached = localStorage.getItem(LOCAL_SPENDIQ_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.activities) && parsed.activities.length > 0) {
        return parsed;
      }
    }
  } catch {}

  // Fallback 3: Bundled fallback snapshot
  if (Array.isArray(spendiqFallback) && spendiqFallback.length > 0) {
    return formatRawTransactionsToSpendIqResult(spendiqFallback as SpendIqRawTransaction[], options);
  }

  return {
    activities: [],
    spendingContext: {
      todaySpentJpy: 0,
      todaySpentInr: 0,
      todayTxCount: 0,
      weekSpentJpy: 0,
      weekSpentInr: 0,
    },
  };
}

export interface SyncCalendarOptions {
  timeZone?: string;
  accountEmail?: string;
  fullSync?: boolean;
}

export interface SyncCalendarResult {
  activities: KairoActivity[];
  scheduleGapNote?: string;
  nearestUpcomingEvent?: any;
  upNext?: any;
  syncMetadata?: any;
  eventsStoredCount?: number;
  upcomingEventsCount?: number;
}

export async function syncGoogleCalendar(
  accessToken: string,
  options: SyncCalendarOptions = {}
): Promise<SyncCalendarResult> {
  const res = await fetch('/api/calendar/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}: Failed to sync Google Calendar`);
  }

  const data = await res.json();
  return {
    activities: data.activities || [],
    scheduleGapNote: data.scheduleGapNote,
    nearestUpcomingEvent: data.nearestUpcomingEvent,
    upNext: data.upNext,
    syncMetadata: data.syncMetadata,
    eventsStoredCount: data.eventsStoredCount,
    upcomingEventsCount: data.upcomingEventsCount,
  };
}

export async function fetchCalendarUpNext(timeZone: string = 'Asia/Tokyo'): Promise<{
  hasUpcomingEvent: boolean;
  upNext: any | null;
  rawEvent: any | null;
  totalUpcomingCount: number;
  syncMetadata?: any;
}> {
  try {
    const res = await fetch(`/api/calendar/up-next?timeZone=${encodeURIComponent(timeZone)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err: any) {
    console.warn('Failed to query /api/calendar/up-next:', err.message);
  }
  return { hasUpcomingEvent: false, upNext: null, rawEvent: null, totalUpcomingCount: 0 };
}

export async function fetchCalendarDatabaseEvents(timeZone: string = 'Asia/Tokyo'): Promise<{
  activities: KairoActivity[];
  nearestUpcomingEvent: any | null;
  upNext: any | null;
  scheduleGapNote?: string;
  syncMetadata?: any;
}> {
  try {
    const res = await fetch(`/api/calendar/events?timeZone=${encodeURIComponent(timeZone)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err: any) {
    console.warn('Failed to query /api/calendar/events:', err.message);
  }
  return { activities: [], nearestUpcomingEvent: null, upNext: null };
}

export async function fetchCalendarDiagnostics(): Promise<any> {
  try {
    const res = await fetch('/api/calendar/diagnostics');
    if (res.ok) {
      return await res.json();
    }
  } catch (err: any) {
    console.warn('Failed to query /api/calendar/diagnostics:', err.message);
  }
  return null;
}

export interface SyncClassroomResult {
  assignments: ClassroomAssignment[];
  activities: KairoActivity[];
}

export async function syncGoogleClassroom(
  accessToken: string,
  options: { timeZone?: string } = {}
): Promise<SyncClassroomResult> {
  const res = await fetch('/api/classroom/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.warn('Classroom sync returned:', res.status, errorData);
    return { assignments: [], activities: [] };
  }

  const data = await res.json();
  return {
    assignments: data.assignments || [],
    activities: data.activities || [],
  };
}

export interface SyncGmailOptions {
  timeZone?: string;
  accountEmail?: string;
}

export interface SyncGmailResult {
  insights: ScoredEmailInsight[];
  activities: KairoActivity[];
}

export async function syncGmail(
  accessToken: string,
  options: SyncGmailOptions = {}
): Promise<SyncGmailResult> {
  try {
    const res = await fetch('/api/gmail/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.warn('Gmail sync returned:', res.status, errorData);
      return { insights: [], activities: [] };
    }

    const data = await res.json();
    return {
      insights: data.insights || [],
      activities: data.activities || [],
    };
  } catch (err) {
    console.warn('Failed to sync Gmail:', err);
    return { insights: [], activities: [] };
  }
}

// --- Stock Watchlist ---
export async function fetchStockWatchlist(
  timeZone?: string
): Promise<{ quotes: StockQuote[]; activities: KairoActivity[] }> {
  try {
    const params = new URLSearchParams();
    if (timeZone) params.set('timeZone', timeZone);
    const res = await fetch(`/api/stocks/watchlist?${params.toString()}`);
    if (!res.ok) return { quotes: [], activities: [] };
    const data = await res.json();
    return {
      quotes: data.quotes || [],
      activities: data.activities || [],
    };
  } catch (err) {
    console.warn('Error fetching stock watchlist:', err);
    return { quotes: [], activities: [] };
  }
}

// --- Persistent User Portfolio ---
export async function fetchPortfolio(): Promise<{
  holdings: PortfolioHolding[];
  totalCostBasis: number;
  count: number;
}> {
  try {
    const res = await fetch('/api/portfolio');
    if (!res.ok) return { holdings: [], totalCostBasis: 45310.11, count: 0 };
    const data = await res.json();
    return {
      holdings: data.holdings || [],
      totalCostBasis: data.totalCostBasis || 45310.11,
      count: data.count || 0,
    };
  } catch {
    return { holdings: [], totalCostBasis: 45310.11, count: 0 };
  }
}

// --- User Visit State & Since You Last Checked ---
export async function fetchUserState(userId: string = 'default'): Promise<UserState | null> {
  try {
    const res = await fetch(`/api/user/state?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.userState || null;
  } catch {
    return null;
  }
}

export async function markUserChecked(userId: string = 'default'): Promise<number> {
  try {
    const res = await fetch('/api/user/mark-checked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return Date.now();
    const data = await res.json();
    return data.last_checked_at || Date.now();
  } catch {
    return Date.now();
  }
}

export async function fetchSinceLastChecked(
  userId: string = 'default'
): Promise<{ hasChanges: boolean; items: SinceLastCheckedItem[]; lastCheckedAt: number }> {
  try {
    const res = await fetch(`/api/user/since-last-checked?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return { hasChanges: false, items: [], lastCheckedAt: Date.now() };
    const data = await res.json();
    return {
      hasChanges: !!data.hasChanges,
      items: data.items || [],
      lastCheckedAt: data.last_checked_at || Date.now(),
    };
  } catch {
    return { hasChanges: false, items: [], lastCheckedAt: Date.now() };
  }
}

// --- Weekly Recap ---
export async function fetchWeeklyRecap(timeZone?: string): Promise<WeeklyRecapData | null> {
  try {
    const params = new URLSearchParams();
    if (timeZone) params.set('timeZone', timeZone);
    const res = await fetch(`/api/weekly-recap?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.recap || null;
  } catch {
    return null;
  }
}

// --- Reminders Backend Sync ---
export async function fetchBackendReminders(userId: string = 'default'): Promise<PersonalReminder[]> {
  try {
    const res = await fetch(`/api/reminders?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.reminders || [];
  } catch {
    return [];
  }
}

export async function saveBackendReminder(reminder: PersonalReminder): Promise<PersonalReminder | null> {
  try {
    const res = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reminder),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.reminder || null;
  } catch {
    return null;
  }
}

export async function updateBackendReminderStatus(
  id: string,
  status: ReminderStatus
): Promise<PersonalReminder | null> {
  try {
    const res = await fetch(`/api/reminders/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.reminder || null;
  } catch {
    return null;
  }
}

export async function confirmBackendFlights(id: string): Promise<PersonalReminder | null> {
  try {
    const res = await fetch(`/api/reminders/${encodeURIComponent(id)}/flights-booked`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.reminder || null;
  } catch {
    return null;
  }
}

export async function deleteBackendReminder(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/reminders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Merge activities and sort them strictly descending by `occurredAt`
 * Prevents duplicates by entity ID.
 */
export function mergeAndSortActivities(...sources: KairoActivity[][]): KairoActivity[] {
  const map = new Map<string, KairoActivity>();

  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const act of list) {
      if (act && act.id) {
        map.set(act.id, act);
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.occurredAt - a.occurredAt);
}
