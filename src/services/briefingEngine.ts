import {
  KairoActivity,
  ClassroomAssignment,
  PersonalReminder,
  AttentionItem,
  UpNextItem,
} from '../types/activity';

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
    .replace(/^(Your next class is\s*|Your next event is\s*|You have\s*|Tomorrow, you have\s*|Tomorrow at [^:]+:\s*|In \d+ days:\s*)/i, '')
    .replace(/\s+at\s+\d{1,2}:\d{2}\s*[AP]M(\s+today)?\.?/i, '')
    .replace(/\(All day\)/i, '')
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

  // 2. Filter genuinely future calendar events
  const futureCalendarEvents = calendarActivities
    .filter((act) => act.activityType === 'calendar_event' && act.occurredAt > nowMs)
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
  const activeReminders = reminders.filter((r) => r.status === 'active' || (!r.completed && r.status !== 'dismissed'));
  const travelTrip = reminders.find((r) => r.is_travel || r.title.toLowerCase().includes('flight') || r.title.toLowerCase().includes('india'));

  // 5. Intelligent "Up Next" Selection across all horizons
  let upNext: UpNextItem | null = null;

  const nextCal = futureCalendarEvents[0];
  const nextAssn = futureAssignments[0];

  // Compare earliest future calendar event vs earliest future assignment
  if (nextCal && nextAssn) {
    if (nextCal.occurredAt <= (nextAssn.dueTimestampMs || Infinity)) {
      const isClass = nextCal.title.toLowerCase().includes('lecture') || nextCal.title.toLowerCase().includes('class');
      const cleanTitle = cleanCalendarTitle(nextCal.title);
      const timing = formatRelativeTiming(nextCal.occurredAt, timeZone, nextCal.timeString);
      const diffDays = Math.ceil((nextCal.occurredAt - nowMs) / 86400000);

      upNext = {
        id: `upnext_${nextCal.id}`,
        category: isClass ? 'class' : 'event',
        headline: cleanTitle,
        contextTime: timing,
        detail: nextCal.detail,
        urgency: diffDays === 0 ? 'now' : diffDays === 1 ? 'tomorrow' : 'soon',
        link: nextCal.link,
      };
    } else {
      const timing = formatRelativeTiming(nextAssn.dueTimestampMs || nowMs, timeZone, nextAssn.dueTimeString);
      const diffDays = Math.ceil(((nextAssn.dueTimestampMs || nowMs) - nowMs) / 86400000);

      upNext = {
        id: `upnext_assn_${nextAssn.id}`,
        category: 'assignment',
        headline: `${nextAssn.courseName} · ${nextAssn.title}`,
        contextTime: `Deadline: ${timing}`,
        detail: 'Academic course deadline',
        urgency: diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : 'soon',
        link: nextAssn.alternateLink,
      };
    }
  } else if (nextCal) {
    const isClass = nextCal.title.toLowerCase().includes('lecture') || nextCal.title.toLowerCase().includes('class');
    const cleanTitle = cleanCalendarTitle(nextCal.title);
    const timing = formatRelativeTiming(nextCal.occurredAt, timeZone, nextCal.timeString);
    const diffDays = Math.ceil((nextCal.occurredAt - nowMs) / 86400000);

    upNext = {
      id: `upnext_${nextCal.id}`,
      category: isClass ? 'class' : 'event',
      headline: cleanTitle,
      contextTime: timing,
      detail: nextCal.detail,
      urgency: diffDays === 0 ? 'now' : diffDays === 1 ? 'tomorrow' : 'soon',
      link: nextCal.link,
    };
  } else if (nextAssn) {
    const timing = formatRelativeTiming(nextAssn.dueTimestampMs || nowMs, timeZone, nextAssn.dueTimeString);
    const diffDays = Math.ceil(((nextAssn.dueTimestampMs || nowMs) - nowMs) / 86400000);

    upNext = {
      id: `upnext_assn_${nextAssn.id}`,
      category: 'assignment',
      headline: `${nextAssn.courseName} · ${nextAssn.title}`,
      contextTime: `Deadline: ${timing}`,
      detail: 'Academic course deadline',
      urgency: diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : 'soon',
      link: nextAssn.alternateLink,
    };
  } else if (travelTrip && !travelTrip.flights_booked) {
    upNext = {
      id: `upnext_travel_${travelTrip.id}`,
      category: 'travel',
      headline: travelTrip.title,
      contextTime: 'Target: 2nd–3rd week of Nov',
      detail: 'Trip dates: Jan 5 – Apr 5, 2027 · Book before fares rise',
      urgency: 'soon',
    };
  } else if (activeReminders.length > 0) {
    const rem = activeReminders[0];
    upNext = {
      id: `upnext_rem_${rem.id}`,
      category: 'reminder',
      headline: rem.title,
      contextTime: rem.target_date ? `Target: ${rem.target_date}` : 'Active Plan',
      detail: rem.details || rem.context,
      urgency: 'soon',
    };
  }

  // 6. Dynamic Personal Opening Summary
  const sentences: string[] = [];
  const attentionItems: AttentionItem[] = [];
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
      sentences.push("Your schedule is completely clear with no upcoming appointments or classes.");
    }

    if (scheduleGapNote) {
      sentences.push(scheduleGapNote);
    }
  }

  // Sentence 2: Deadlines & Assignments
  if (dueTodayAssignments.length > 0) {
    const top = dueTodayAssignments[0];
    sentences.push(`Your ${top.courseName} assignment is due today at ${top.dueTimeString}.`);
    attentionItems.push({
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
    attentionItems.push({
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

  // Sentence 3: Life admin, travel, or portfolio summary
  if (travelTrip && !travelTrip.flights_booked) {
    sentences.push("You planned to book your India flights during the 2nd–3rd week of November.");
    attentionItems.push({
      id: `att_trip_${travelTrip.id}`,
      type: 'travel_prep',
      title: 'Book India flights',
      subtitle: 'Target window: Nov 8–21 · Outbound Jan 5, Return Apr 5',
      urgency: 'medium',
      actionId: travelTrip.id,
      actionType: 'confirm_flights',
    });
  } else if (travelTrip && travelTrip.flights_booked) {
    sentences.push("India flights are confirmed for Jan 5 – Apr 5.");
    attentionItems.push({
      id: `att_trip_prep_${travelTrip.id}`,
      type: 'travel_prep',
      title: 'India trip travel preparations',
      subtitle: 'Flights confirmed · Review packing list & documents for Jan 5 departure',
      urgency: 'medium',
      actionId: travelTrip.id,
      actionType: 'complete_reminder',
    });
  } else if (activeReminders.length > 0) {
    const rem = activeReminders[0];
    sentences.push(`Reminder active: ${rem.title}.`);
    attentionItems.push({
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

  // Fill attention items up to 3
  for (const rem of activeReminders) {
    if (rem.id !== travelTrip?.id && !attentionItems.some((a) => a.actionId === rem.id) && attentionItems.length < 3) {
      attentionItems.push({
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

  const finalSentences = sentences.slice(0, 3);

  return {
    greeting,
    sentences: finalSentences,
    attentionItems,
    upNext,
    scheduleClear,
  };
}
