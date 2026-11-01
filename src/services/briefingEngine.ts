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

  // 2. Classify calendar events
  const todayEvents = calendarActivities
    .filter((act) => act.dateHeader === 'TODAY' && act.activityType === 'calendar_event')
    .sort((a, b) => a.occurredAt - b.occurredAt);

  const tomorrowEvents = calendarActivities
    .filter((act) => act.dateHeader === 'TOMORROW' && act.activityType === 'calendar_event')
    .sort((a, b) => a.occurredAt - b.occurredAt);

  const upcomingToday = todayEvents.filter((e) => e.occurredAt > nowMs);
  const pastToday = todayEvents.filter((e) => e.occurredAt <= nowMs);

  // 3. Classify assignments
  const activeAssignments = [...assignments].sort(
    (a, b) => (a.dueTimestampMs || 0) - (b.dueTimestampMs || 0)
  );
  const dueTodayAssignments = activeAssignments.filter((a) => a.urgency === 'today');
  const dueTomorrowAssignments = activeAssignments.filter((a) => a.urgency === 'tomorrow');
  const dueSoonAssignments = activeAssignments.filter((a) => a.urgency === 'soon');

  // 4. Active personal reminders & Travel context
  const activeReminders = reminders.filter((r) => r.status === 'active' || (!r.completed && r.status !== 'dismissed'));
  const travelTrip = reminders.find((r) => r.is_travel || r.title.toLowerCase().includes('flight') || r.title.toLowerCase().includes('india'));

  // 5. Intelligent Up Next Selection (Strictly 1 primary item)
  let upNext: UpNextItem | null = null;

  // Criterion A: Is an event happening later today?
  if (upcomingToday.length > 0) {
    const nextEvent = upcomingToday[0];
    const isClass = nextEvent.title.toLowerCase().includes('lecture') || nextEvent.title.toLowerCase().includes('class');
    const cleanTitle = nextEvent.title
      .replace(/^Your next class is\s*/i, '')
      .replace(/^Your next event is\s*/i, '')
      .replace(/^You have\s*/i, '')
      .replace(/at\s+\d+:\d+\s+[AP]M\s+today\.?/i, '')
      .trim();

    upNext = {
      id: `upnext_${nextEvent.id}`,
      category: isClass ? 'class' : 'event',
      headline: cleanTitle || 'Upcoming Commitment',
      contextTime: `Today at ${nextEvent.timeString}`,
      detail: nextEvent.detail,
      urgency: 'now',
      link: nextEvent.link,
    };
  }
  // Criterion B: Is an assignment due today?
  else if (dueTodayAssignments.length > 0) {
    const topDue = dueTodayAssignments[0];
    upNext = {
      id: `upnext_due_${topDue.id}`,
      category: 'assignment',
      headline: `${topDue.courseName} · ${topDue.title}`,
      contextTime: `Due today at ${topDue.dueTimeString}`,
      detail: 'Academic deadline today',
      urgency: 'today',
      link: topDue.alternateLink,
    };
  }
  // Criterion C: Tomorrow's first class or event
  else if (tomorrowEvents.length > 0) {
    const firstTom = tomorrowEvents[0];
    const isClass = firstTom.title.toLowerCase().includes('lecture') || firstTom.title.toLowerCase().includes('class');
    const cleanTitle = firstTom.title
      .replace(/^Tomorrow at \d+:\d+\s+[AP]M:\s*/i, '')
      .replace(/^Tomorrow, you have\s*/i, '')
      .replace(/at\s+\d+:\d+\s+[AP]M\.?/i, '')
      .trim();

    upNext = {
      id: `upnext_${firstTom.id}`,
      category: isClass ? 'class' : 'event',
      headline: cleanTitle || 'Tomorrow\'s Event',
      contextTime: `Tomorrow at ${firstTom.timeString}`,
      detail: firstTom.detail,
      urgency: 'tomorrow',
      link: firstTom.link,
    };
  }
  // Criterion D: Assignment due tomorrow
  else if (dueTomorrowAssignments.length > 0) {
    const tomDue = dueTomorrowAssignments[0];
    upNext = {
      id: `upnext_due_tom_${tomDue.id}`,
      category: 'assignment',
      headline: `${tomDue.courseName} · ${tomDue.title}`,
      contextTime: `Due tomorrow at ${tomDue.dueTimeString}`,
      detail: 'Academic deadline tomorrow',
      urgency: 'tomorrow',
      link: tomDue.alternateLink,
    };
  }
  // Criterion E: Travel or active high-priority reminder
  else if (travelTrip && !travelTrip.flights_booked) {
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

  // 6. Synthesize Concise 2–3 Sentences Daily Briefing
  const sentences: string[] = [];
  const attentionItems: AttentionItem[] = [];

  // Sentence 1: Today's status & Schedule context
  if (hour >= 17) {
    // Evening tone
    if (todayEvents.length > 0 && pastToday.length === todayEvents.length) {
      sentences.push("You're all done with scheduled commitments for today.");
    } else if (upcomingToday.length > 0) {
      sentences.push(`You have one last event today: ${upcomingToday[0].timeString}.`);
    } else {
      sentences.push("You have a quiet evening ahead with no remaining meetings.");
    }
  } else {
    // Morning / Afternoon tone
    if (todayEvents.length === 0) {
      sentences.push("You have no classes or meetings scheduled for today.");
    } else if (upcomingToday.length > 0) {
      const nextOne = upcomingToday[0];
      const isClass = nextOne.title.toLowerCase().includes('lecture') || nextOne.title.toLowerCase().includes('class');
      const eventWord = isClass ? 'class' : 'event';
      sentences.push(
        `You have ${todayEvents.length} scheduled ${todayEvents.length === 1 ? eventWord : eventWord + 'es'} today, with your next at ${nextOne.timeString}.`
      );
    } else {
      sentences.push(`You completed all ${todayEvents.length} commitments for today.`);
    }

    // Schedule gap context if notable
    if (scheduleGapNote) {
      sentences.push(scheduleGapNote);
    }
  }

  // Sentence 2: Academic assignments
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
  } else if (dueSoonAssignments.length > 0) {
    const top = dueSoonAssignments[0];
    const diffDays = Math.max(1, Math.ceil(((top.dueTimestampMs || 0) - nowMs) / 86400000));
    sentences.push(`Your ${top.courseName} assignment is due in ${diffDays} days.`);
  }

  // Sentence 3: Tomorrow's preview or Travel preparation
  if (tomorrowEvents.length > 0) {
    const firstTom = tomorrowEvents[0];
    const isClass = firstTom.title.toLowerCase().includes('lecture') || firstTom.title.toLowerCase().includes('class');
    const label = isClass ? 'classes' : 'events';
    sentences.push(
      `Tomorrow, you have ${tomorrowEvents.length} ${tomorrowEvents.length === 1 ? (isClass ? 'class' : 'event') : label} starting at ${firstTom.timeString}.`
    );
  } else if (travelTrip && !travelTrip.flights_booked) {
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
    sentences.push("India flights are booked for Jan 5 – Apr 5.");
    attentionItems.push({
      id: `att_trip_prep_${travelTrip.id}`,
      type: 'travel_prep',
      title: 'India trip travel preparations',
      subtitle: 'Flights confirmed · Review packing list & documents for Jan 5 departure',
      urgency: 'medium',
      actionId: travelTrip.id,
      actionType: 'complete_reminder',
    });
  }

  // Add any non-travel active reminders to attentionItems if space permits
  for (const rem of activeReminders) {
    if (rem.id !== travelTrip?.id && attentionItems.length < 3) {
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

  // Keep briefing strictly to 2–3 sentences for clarity
  const finalSentences = sentences.slice(0, 3);

  return {
    greeting,
    sentences: finalSentences,
    attentionItems,
    upNext,
  };
}
