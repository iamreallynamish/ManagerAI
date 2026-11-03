import {
  KairoActivity,
  ClassroomAssignment,
  PersonalReminder,
  AttentionItem,
  UpNextItem,
  StockQuote,
} from '../types/activity';
import { ScoredEmailInsight } from './emailIntelligence';

export interface BriefingResult {
  greeting: string;
  sentences: string[];
  attentionItems: AttentionItem[];
  upNext: UpNextItem | null;
  scheduleClear: boolean;
}

function cleanCalendarTitle(raw: string): string {
  if (!raw) return 'Scheduled commitment';
  return raw
    .replace(/^(Your next class is\s*|Your next event is\s*|You have\s*|Tomorrow, you have\s*|Tomorrow:\s*|Tomorrow at [^:]+:\s*|In \d+ days:\s*)/i, '')
    .replace(/\s+at\s+\d{1,2}:\d{2}\s*[AP]M(\s+today)?\.?/i, '')
    .replace(/\(All day\)/i, '')
    .replace(/\(Completed\)/i, '')
    .trim();
}

function formatRelativeTiming(targetMs: number, timeZone: string, timeString?: string): string {
  const now = new Date();
  const diffMs = targetMs - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);

  const targetDate = new Date(targetMs);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(targetDate);
  const monthDay = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(targetDate);

  if (diffDays <= 0) {
    return timeString ? `Today at ${timeString}` : 'Today';
  } else if (diffDays === 1) {
    return timeString ? `Tomorrow at ${timeString}` : 'Tomorrow';
  } else if (diffDays <= 6) {
    return timeString ? `In ${diffDays} days (${weekday}) at ${timeString}` : `In ${diffDays} days (${weekday})`;
  } else {
    return timeString ? `In ${diffDays} days on ${monthDay} at ${timeString}` : `In ${diffDays} days on ${monthDay}`;
  }
}

export function synthesizeBriefing(options: {
  userName?: string;
  timeZone: string;
  calendarActivities: KairoActivity[];
  assignments: ClassroomAssignment[];
  reminders: PersonalReminder[];
  scheduleGapNote?: string;
  emailInsights?: ScoredEmailInsight[];
  recentStockMoves?: StockQuote[];
  todaySpendingContext?: {
    todaySpentJpy: number;
    todaySpentInr: number;
    todayTxCount: number;
  };
}): BriefingResult {
  const {
    userName = 'Namish',
    timeZone,
    calendarActivities,
    assignments,
    reminders,
    scheduleGapNote,
    emailInsights = [],
    recentStockMoves = [],
  } = options;

  const now = new Date();
  const nowMs = now.getTime();

  // 1. Time-of-day greeting
  let hour = 9;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const hPart = parts.find((p) => p.type === 'hour');
    if (hPart) hour = parseInt(hPart.value, 10);
  } catch {
    hour = now.getHours();
  }

  let timeGreeting = 'Good morning';
  if (hour >= 12 && hour < 17) {
    timeGreeting = 'Good afternoon';
  } else if (hour >= 17 || hour < 5) {
    timeGreeting = 'Good evening';
  }

  const greeting = `${timeGreeting}, ${userName}.`;

  // 2. Filter genuinely future calendar events across all horizons (not yet ended)
  const futureCalendarEvents = calendarActivities
    .filter(
      (act) =>
        act.activityType === 'calendar_event' &&
        ((act.endAt && act.endAt > nowMs) || act.occurredAt > nowMs)
    )
    .sort((a, b) => a.occurredAt - b.occurredAt);

  const todayEvents = calendarActivities
    .filter((act) => act.dateHeader === 'TODAY' && act.activityType === 'calendar_event')
    .sort((a, b) => a.occurredAt - b.occurredAt);

  const tomorrowEvents = calendarActivities
    .filter((act) => act.dateHeader === 'TOMORROW' && act.activityType === 'calendar_event')
    .sort((a, b) => a.occurredAt - b.occurredAt);

  const pastToday = todayEvents.filter((e) => e.occurredAt <= nowMs);

  // 3. Filter genuinely future assignments
  const futureAssignments = [...assignments]
    .filter((a) => (a.dueTimestampMs || 0) > nowMs)
    .sort((a, b) => (a.dueTimestampMs || 0) - (b.dueTimestampMs || 0));

  const dueTodayAssignments = assignments.filter((a) => a.urgency === 'today');
  const dueTomorrowAssignments = assignments.filter((a) => a.urgency === 'tomorrow');

  // 4. Active personal reminders & Travel context
  // The India flights reminder remains active until explicitly marked completed
  const activeReminders = reminders.filter(
    (r) => r.status === 'active' || (!r.completed && r.status !== 'dismissed')
  );
  const travelTrip = reminders.find(
    (r) => r.is_travel || r.title.toLowerCase().includes('flight') || r.title.toLowerCase().includes('india')
  );

  // 5. Intelligent "Up Next" Selection across all horizons
  // User strict priority order:
  // 1. The nearest upcoming meaningful Google Calendar event from any connected Google account.
  // 2. If there is no upcoming calendar event, show the highest-priority active reminder.
  // 3. If neither exists, show a useful contextual status message.
  let upNext: UpNextItem | null = null;
  let upNextSourceId: string | null = null;

  if (futureCalendarEvents.length > 0) {
    // 1. Prioritize live calendar event
    const nextCal = futureCalendarEvents[0];
    const isClass = nextCal.title.toLowerCase().includes('lecture') || nextCal.title.toLowerCase().includes('class');
    const cleanTitle = cleanCalendarTitle(nextCal.title);
    const timing = formatRelativeTiming(nextCal.occurredAt, timeZone, nextCal.timeString);
    const diffDays = Math.max(0, Math.ceil((nextCal.occurredAt - nowMs) / 86400000));

    upNext = {
      id: `upnext_${nextCal.id}`,
      category: isClass ? 'class' : 'event',
      headline: cleanTitle,
      contextTime: timing,
      detail: nextCal.detail,
      urgency: diffDays === 0 ? 'now' : diffDays === 1 ? 'today' : 'soon',
      link: nextCal.link,
    };
    upNextSourceId = nextCal.id;
  } else if (activeReminders.length > 0) {
    // 2. Highest-priority active reminder (e.g. India flights or other high priority plan)
    const topRem = activeReminders.find((r) => r.priority === 'high') || activeReminders[0];
    const isFlight = topRem.is_travel || topRem.title.toLowerCase().includes('flight');

    upNext = {
      id: `upnext_rem_${topRem.id}`,
      category: isFlight ? 'travel' : 'reminder',
      headline: topRem.title,
      contextTime: topRem.target_date ? `Target: ${topRem.target_date}` : 'Active Reminder',
      detail: topRem.details || topRem.context || 'High-priority personal reminder',
      urgency: 'soon',
    };
    upNextSourceId = topRem.id;
  } else if (futureAssignments.length > 0) {
    const nextAssn = futureAssignments[0];
    const timing = formatRelativeTiming(nextAssn.dueTimestampMs || nowMs, timeZone, nextAssn.dueTimeString);
    const diffDays = Math.max(0, Math.ceil(((nextAssn.dueTimestampMs || nowMs) - nowMs) / 86400000));

    upNext = {
      id: `upnext_assn_${nextAssn.id}`,
      category: 'assignment',
      headline: `${nextAssn.courseName} · ${nextAssn.title}`,
      contextTime: `Deadline: ${timing}`,
      detail: 'Academic course deadline',
      urgency: diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : 'soon',
      link: nextAssn.alternateLink,
    };
    upNextSourceId = nextAssn.id;
  } else {
    // 3. Useful contextual status message
    upNext = {
      id: 'upnext_clear',
      category: 'event',
      headline: 'Schedule Clear',
      contextTime: 'No upcoming events',
      detail: 'All commitments and active reminders are up to date.',
      urgency: 'soon',
    };
    upNextSourceId = 'clear';
  }

  // 6. Dynamic Personal Opening Summary
  const sentences: string[] = [];
  const rawAttentionItems: AttentionItem[] = [];
  const scheduleClear = futureCalendarEvents.length === 0 && futureAssignments.length === 0;

  // Sentence 1: Today's status or the next genuine commitment
  if (hour >= 17) {
    // Evening tone
    if (todayEvents.length > 0 && pastToday.length === todayEvents.length) {
      sentences.push("You're all done with scheduled commitments for today.");
    } else if (todayEvents.length > 0 && futureCalendarEvents.some((e) => e.dateHeader === 'TODAY')) {
      const nextOne = futureCalendarEvents.find((e) => e.dateHeader === 'TODAY')!;
      sentences.push(`You have one last event today: ${cleanCalendarTitle(nextOne.title)} at ${nextOne.timeString}.`);
    } else if (futureCalendarEvents.length > 0) {
      const nextEv = futureCalendarEvents[0];
      const timing = formatRelativeTiming(nextEv.occurredAt, timeZone, nextEv.timeString);
      sentences.push(`Your next scheduled commitment is ${cleanCalendarTitle(nextEv.title)}, ${timing}.`);
    } else if (futureAssignments.length > 0) {
      const nextAs = futureAssignments[0];
      const timing = formatRelativeTiming(nextAs.dueTimestampMs || nowMs, timeZone, nextAs.dueTimeString);
      sentences.push(`Your next academic deadline is ${nextAs.courseName} (${nextAs.title}), ${timing}.`);
    } else {
      sentences.push("Your schedule is completely clear for the coming days.");
    }
  } else {
    // Daytime tone
    const upcomingToday = todayEvents.filter((e) => e.occurredAt > nowMs);
    if (upcomingToday.length > 0) {
      const nextOne = upcomingToday[0];
      const isClass = nextOne.title.toLowerCase().includes('lecture') || nextOne.title.toLowerCase().includes('class');
      const eventWord = isClass ? 'class' : 'commitment';
      sentences.push(
        `You have ${upcomingToday.length} scheduled ${upcomingToday.length === 1 ? eventWord : eventWord + 's'} remaining today, next at ${nextOne.timeString}.`
      );
    } else if (todayEvents.length > 0) {
      sentences.push(`You completed all ${todayEvents.length} scheduled commitments for today.`);
    } else if (tomorrowEvents.length > 0) {
      const firstTom = tomorrowEvents[0];
      sentences.push(
        `Your schedule is open today; your next event is tomorrow at ${firstTom.timeString} (${cleanCalendarTitle(firstTom.title)}).`
      );
    } else if (futureCalendarEvents.length > 0) {
      const nextEv = futureCalendarEvents[0];
      const timing = formatRelativeTiming(nextEv.occurredAt, timeZone, nextEv.timeString);
      sentences.push(`You have no events today. Your next commitment is ${cleanCalendarTitle(nextEv.title)}, ${timing}.`);
    } else if (futureAssignments.length > 0) {
      const nextAs = futureAssignments[0];
      const timing = formatRelativeTiming(nextAs.dueTimestampMs || nowMs, timeZone, nextAs.dueTimeString);
      sentences.push(`Your schedule is open today. Your next deadline is ${nextAs.courseName} (${nextAs.title}), ${timing}.`);
    } else {
      sentences.push("Your schedule is clear with no immediate appointments.");
    }

    if (scheduleGapNote) {
      sentences.push(scheduleGapNote);
    }
  }

  // Sentence 2: High-priority verified email insights or academic deadlines
  if (emailInsights.length > 0 && emailInsights[0].isHighPriority) {
    const topEmail = emailInsights[0];
    sentences.push(`New high-priority notice: ${topEmail.subject}.`);
    rawAttentionItems.push({
      id: `att_email_${topEmail.id}`,
      type: 'email_action',
      title: topEmail.subject,
      subtitle: `${topEmail.sender} · ${topEmail.summary}`,
      urgency: 'high',
      actionType: 'open_link',
    });
  } else if (dueTodayAssignments.length > 0) {
    const top = dueTodayAssignments[0];
    sentences.push(`Your ${top.courseName} assignment is due today at ${top.dueTimeString}.`);
    rawAttentionItems.push({
      id: `att_assign_${top.id}`,
      type: 'assignment_due',
      title: `${top.courseName} assignment due today`,
      subtitle: `Due at ${top.dueTimeString} · ${top.title}`,
      urgency: 'high',
      link: top.alternateLink,
      actionType: 'open_link',
    });
  } else if (dueTomorrowAssignments.length > 0) {
    const top = dueTomorrowAssignments[0];
    sentences.push(`Your ${top.courseName} assignment is due tomorrow at ${top.dueTimeString}.`);
    rawAttentionItems.push({
      id: `att_assign_${top.id}`,
      type: 'assignment_due',
      title: `${top.courseName} assignment due tomorrow`,
      subtitle: `Due at ${top.dueTimeString} · ${top.title}`,
      urgency: 'high',
      link: top.alternateLink,
      actionType: 'open_link',
    });
  } else if (futureAssignments.length > 0) {
    const top = futureAssignments[0];
    const diffDays = Math.max(1, Math.ceil(((top.dueTimestampMs || 0) - nowMs) / 86400000));
    sentences.push(`Your next assignment (${top.courseName}) is due in ${diffDays} days.`);
  }

  // Sentence 3: Active reminders, travel plans, or verified stock movements
  const meaningfulStock = recentStockMoves.find((s) => s.meaningful);
  const isTripActive = travelTrip && !travelTrip.completed && !travelTrip.flights_booked && travelTrip.status === 'active';

  if (isTripActive) {
    sentences.push("You planned to book your India flights during the 2nd–3rd week of November.");
    rawAttentionItems.push({
      id: `att_trip_${travelTrip.id}`,
      type: 'travel_prep',
      title: 'Book India flights',
      subtitle: 'Target window: Nov 8–21 · Outbound Jan 5, Return Apr 5',
      urgency: 'medium',
      actionId: travelTrip.id,
      actionType: 'confirm_flights',
    });
  } else if (meaningfulStock) {
    const sign = meaningfulStock.changePct >= 0 ? '+' : '';
    sentences.push(
      `${meaningfulStock.companyName} moved ${sign}${meaningfulStock.changePct.toFixed(1)}% on NSE.`
    );
  } else if (activeReminders.length > 0) {
    const rem = activeReminders.find((r) => r.id !== travelTrip?.id) || activeReminders[0];
    sentences.push(`Active reminder: ${rem.title}.`);
    rawAttentionItems.push({
      id: `att_rem_${rem.id}`,
      type: 'reminder_active',
      title: rem.title,
      subtitle: rem.details || rem.context,
      urgency: rem.priority === 'high' ? 'high' : 'medium',
      actionId: rem.id,
      actionType: 'complete_reminder',
    });
  } else {
    sentences.push("Your investment portfolio of 5 holdings stands steady at ₹45,310.11 cost basis.");
  }

  // Fill rawAttentionItems up to 3 items with remaining active reminders
  for (const rem of activeReminders) {
    if (rem.id !== travelTrip?.id && !rawAttentionItems.some((a) => a.actionId === rem.id) && rawAttentionItems.length < 3) {
      rawAttentionItems.push({
        id: `att_rem_${rem.id}`,
        type: 'reminder_active',
        title: rem.title,
        subtitle: rem.details || rem.context,
        urgency: rem.priority === 'high' ? 'high' : 'medium',
        actionId: rem.id,
        actionType: 'complete_reminder',
      });
    }
  }

  // CRITICAL RULE: De-duplicate items so nothing shown in "Up Next" appears in "Worth Remembering"
  const attentionItems = rawAttentionItems.filter((item) => {
    if (!upNext) return true;
    if (upNextSourceId && item.actionId && upNextSourceId === item.actionId) {
      return false;
    }
    if (upNext.category === 'travel' && item.type === 'travel_prep') {
      return false;
    }
    if (upNext.id.includes(item.id.replace('att_assign_', '')) || upNext.id.includes(item.id.replace('att_rem_', ''))) {
      return false;
    }
    return true;
  });

  const finalSentences = sentences.slice(0, 3);

  return {
    greeting,
    sentences: finalSentences,
    attentionItems,
    upNext,
    scheduleClear,
  };
}
