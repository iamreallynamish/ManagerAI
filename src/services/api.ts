import {
  KairoActivity,
  ClassroomAssignment,
  StockQuote,
  SinceLastCheckedItem,
  WeeklyRecapData,
  PersonalReminder,
  UserState,
  ReminderStatus,
} from '../types/activity';

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

export async function fetchSpendIqActivities(
  options: FetchTransactionsOptions = {}
): Promise<SpendIqFetchResult> {
  const params = new URLSearchParams();
  if (options.timeZone) params.set('timeZone', options.timeZone);
  if (options.showAllSpenders !== undefined) params.set('showAllSpenders', String(options.showAllSpenders));
  if (options.spender) params.set('spender', options.spender);
  if (options.limitDays !== undefined) params.set('limitDays', String(options.limitDays));
  else params.set('limitDays', '7');

  const res = await fetch(`/api/spendiq/transactions?${params.toString()}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}: Failed to fetch Spend IQ transactions`);
  }

  const data = await res.json();
  return {
    activities: data.activities || [],
    spendingContext: data.spendingContext,
  };
}

export interface SyncCalendarOptions {
  timeZone?: string;
  timeMin?: string;
  timeMax?: string;
}

export interface SyncCalendarResult {
  activities: KairoActivity[];
  scheduleGapNote?: string;
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
  };
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
