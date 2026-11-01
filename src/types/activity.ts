export type ActivitySource = 'spend_iq' | 'calendar' | 'classroom' | 'stocks' | 'reminder' | 'system';

export interface KairoActivity {
  id: string;                      // `tx_${tx.id}`, `cal_${event.id}`, `class_${work.id}`, `stock_${symbol}`, `rem_${rem.id}`
  source: ActivitySource;
  activityType?:
    | 'transaction'
    | 'grouped_transaction'
    | 'calendar_event'
    | 'calendar_summary'
    | 'calendar_empty'
    | 'assignment'
    | 'stock_move'
    | 'reminder'
    | 'travel';
  title: string;                   // E.g. "You spent ¥226 at 7-ELEVEN." or "Economics Assignment due tomorrow"
  detail?: string;                 // Context e.g. "ICICI Forex XX0817 · Convenience Store" or "Macroeconomics · Due 11:59 PM"
  amount?: {
    jpy?: number;
    inr?: number;
  };
  category?: string;
  spender?: 'Son' | 'Dad';
  merchant?: string;
  cardUsed?: string;
  relatedEntityId: string;
  occurredAt: number;              // Milliseconds timestamp (epoch UTC)
  timestamp?: number;              // Canonical timestamp alias
  createdAt?: number;              // Creation or sync timestamp
  endAt?: number;
  allDay?: boolean;
  link?: string;
  dateKey: string;                 // E.g. "2026-10-26"
  dateHeader: string;              // E.g. "TOMORROW", "TODAY", "YESTERDAY", "26 OCT 2026"
  timeString: string;              // E.g. "10:00 AM" or "All day"
  urgency?: 'today' | 'tomorrow' | 'soon' | 'later';
  
  // Strict Provenance & Data Integrity
  provenance?: {
    sourceName: 'SpendIQ RTDB' | 'Google Calendar' | 'Google Classroom' | 'NSE Market Provider' | 'Kairo Backend Store';
    verified: boolean;
    recordTimestamp: number;
    dataProvider?: string;
    marketSessionDate?: string;
    isMarketOpen?: boolean;
  };

  // Smart grouping & changes
  isGrouped?: boolean;
  groupedCount?: number;
  subTransactions?: SpendIqRawTransaction[];
  isRescheduled?: boolean;
  originalTime?: string;
  scheduleGapNote?: string;

  // Verified Stocks
  stockData?: {
    ticker?: string;
    exchange?: string;
    symbol: string;
    companyName: string;
    price: number;
    previousClose?: number;
    changePct: number;
    currency: string;
    marketSessionDate?: string;
    isMarketOpen?: boolean;
    sessionLabel?: string;
    dayHigh?: number;
    dayLow?: number;
    dataProvider?: string;
  };
}

export interface SpendIqRawTransaction {
  id: string;
  amountInr?: number;
  amountJpy?: number;
  cardCode?: string;
  cardUsed?: string;
  category?: string;
  date?: string;
  iconBg?: string;
  letter?: string;
  merchant?: string;
  smsBalance?: number;
  spender?: 'Son' | 'Dad';
  subtext?: string;
  timestampMs?: number;
}

export type ReminderTargetFlexibility = 'exact' | 'week_of' | 'month_of' | 'none';
export type ReminderStatus = 'active' | 'completed' | 'dismissed';
export type ReminderPriority = 'low' | 'medium' | 'high';

export interface PersonalReminder {
  id: string;
  user_id?: string;
  title: string;
  details?: string;
  target_date?: string;
  target_date_flexibility?: ReminderTargetFlexibility;
  status: ReminderStatus;
  priority: ReminderPriority;
  created_at: number;
  updated_at: number;
  completed_at?: number | null;

  // Travel awareness extension
  is_travel?: boolean;
  flights_booked?: boolean;
  travel_start_date?: string;
  travel_end_date?: string;

  // Compatibility aliases
  userId?: string;
  context?: string;
  targetWindowStart?: string;
  targetWindowEnd?: string;
  dueDate?: string;
  completed?: boolean;
  createdAt?: number;
}

export interface ClassroomAssignment {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  description?: string;
  dueTimestampMs?: number;
  dueDateString?: string;
  dueTimeString?: string;
  alternateLink?: string;
  urgency: 'today' | 'tomorrow' | 'soon' | 'later';
}

export interface AttentionItem {
  id: string;
  type: 'assignment_due' | 'reminder_active' | 'schedule_change' | 'travel_prep' | 'stock_alert';
  title: string;
  subtitle?: string;
  urgency: 'high' | 'medium';
  link?: string;
  actionId?: string;
  actionType?: 'complete_reminder' | 'confirm_flights' | 'open_link';
}

export interface UpNextItem {
  id: string;
  category: 'class' | 'assignment' | 'event' | 'reminder' | 'travel';
  headline: string;
  contextTime: string;
  detail?: string;
  urgency: 'now' | 'today' | 'tomorrow' | 'soon';
  link?: string;
}

export interface SinceLastCheckedItem {
  id: string;
  source: 'calendar' | 'classroom' | 'spend_iq' | 'stocks' | 'reminder';
  title: string;
  subtitle?: string;
  timestamp: number;
}

export interface UserState {
  user_id: string;
  last_checked_at: number;
  updated_at: number;
}

export interface StockQuote {
  ticker?: string;
  exchange?: 'NSE' | 'BSE';
  symbol: string;
  name: string;
  companyName: string;
  isin?: string;
  price: number;
  previousClose?: number;
  changePct: number;
  currency: string;
  marketSessionDate?: string;
  isMarketOpen?: boolean;
  marketStatusText?: string;
  sessionLabel?: string;
  meaningful: boolean; // ±3% or more
  dayHigh?: number;
  dayLow?: number;
  verifiedAt?: number;
  dataProvider?: string;
}

export interface WeeklyRecapData {
  weekRange: string;
  classesAndEventsCount: number;
  totalSpendingJpy: number;
  totalSpendingInr: number;
  transactionCount: number;
  completedRemindersCount: number;
  keyStockMoves: StockQuote[];
}

export interface UserPreferences {
  timeZone: string;
  showAllSpenders: boolean;
  preferredName?: string;
}
