/**
 * Email Intelligence Service
 * 
 * Multi-signal importance ranking engine for authorized Gmail accounts.
 * Surfaces genuinely critical academic, administrative, and schedule communications
 * while filtering out general newsletters, marketing, automated digests, and noise.
 */

export interface RawGmailMessageSummary {
  id: string;
  threadId: string;
  sender: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  internalDateMs: number;
  labels: string[];
}

export type EmailPriorityCategory =
  | 'assignment_deadline'
  | 'class_schedule_change'
  | 'exam_announcement'
  | 'administrative_deadline'
  | 'financial_requirement'
  | 'visa_immigration'
  | 'scholarship'
  | 'action_required'
  | 'general_notice';

export interface ScoredEmailInsight {
  id: string;
  accountEmail: string;
  sender: string;
  senderEmail: string;
  subject: string;
  summary: string;
  category: EmailPriorityCategory;
  score: number; // 0 - 100
  isHighPriority: boolean;
  actionRequired: boolean;
  deadlineDate?: string;
  receivedAt: number;
  timeString: string;
  dateKey: string;
  signalsMatched: string[];
}

export interface EmailIntelligenceRuleConfig {
  minimumImportanceThreshold: number; // Defaults to 65
  universityDomainWeights: { [domainFragment: string]: number };
  highPriorityKeywords: { [phrase: string]: number };
  lowPriorityKeywords: { [phrase: string]: number };
}

export const DEFAULT_EMAIL_RULES: EmailIntelligenceRuleConfig = {
  minimumImportanceThreshold: 60,
  universityDomainWeights: {
    '.edu': 25,
    '.ac.': 25,
    'university': 20,
    'college': 20,
    'registrar': 25,
    'admissions': 25,
    'bursar': 30,
    'financial': 20,
  },
  highPriorityKeywords: {
    'action required': 40,
    'mandatory': 35,
    'deadline': 30,
    'due date': 30,
    'due today': 45,
    'due tomorrow': 40,
    'payment required': 35,
    'tuition': 25,
    'registration': 25,
    'enrollment': 25,
    'class cancelled': 40,
    'lecture cancelled': 40,
    'schedule change': 35,
    'room change': 35,
    'exam schedule': 35,
    'midterm': 30,
    'final exam': 35,
    'quiz': 25,
    'visa': 35,
    'immigration': 35,
    'form i-20': 40,
    'coop': 20,
    'scholarship': 30,
    'urgent': 25,
    'please complete': 30,
    'verification required': 35,
  },
  lowPriorityKeywords: {
    'unsubscribe': -30,
    'newsletter': -35,
    'weekly digest': -35,
    'promotions': -40,
    'view in browser': -25,
    'sale': -40,
    'special offer': -40,
    'discount': -40,
    'webinar': -20,
    'event invite': -15,
    'social': -25,
  },
};

/**
 * Evaluates an email across multiple criteria to determine true relevance.
 */
export function scoreEmailMessage(
  msg: RawGmailMessageSummary,
  accountEmail: string,
  config: EmailIntelligenceRuleConfig = DEFAULT_EMAIL_RULES
): ScoredEmailInsight {
  let score = 20; // baseline
  const textCorpus = `${msg.subject} ${msg.snippet} ${msg.sender}`.toLowerCase();
  const matchedSignals: string[] = [];

  // Signal 1: Trusted educational or administrative sender domain
  const senderLower = msg.sender.toLowerCase();
  for (const [frag, weight] of Object.entries(config.universityDomainWeights)) {
    if (senderLower.includes(frag)) {
      score += weight;
      matchedSignals.push(`Sender matched "${frag}" (+${weight})`);
      break;
    }
  }

  // Signal 2: High priority keywords & urgency phrases
  for (const [kw, weight] of Object.entries(config.highPriorityKeywords)) {
    if (textCorpus.includes(kw)) {
      score += weight;
      matchedSignals.push(`Keyword "${kw}" (+${weight})`);
    }
  }

  // Signal 3: Penalize marketing, bulk, newsletters
  for (const [kw, penalty] of Object.entries(config.lowPriorityKeywords)) {
    if (textCorpus.includes(kw)) {
      score += penalty;
      matchedSignals.push(`Filter phrase "${kw}" (${penalty})`);
    }
  }

  // Signal 4: Gmail Category Labels
  if (msg.labels.includes('CATEGORY_PROMOTIONS') || msg.labels.includes('CATEGORY_SOCIAL')) {
    score -= 40;
    matchedSignals.push('Promotions/Social label (-40)');
  }
  if (msg.labels.includes('IMPORTANT')) {
    score += 15;
    matchedSignals.push('Gmail Important label (+15)');
  }

  // Categorize
  let category: EmailPriorityCategory = 'general_notice';
  if (textCorpus.includes('due') || textCorpus.includes('assignment') || textCorpus.includes('submission')) {
    category = 'assignment_deadline';
  } else if (textCorpus.includes('cancelled') || textCorpus.includes('schedule') || textCorpus.includes('room change')) {
    category = 'class_schedule_change';
  } else if (textCorpus.includes('exam') || textCorpus.includes('midterm') || textCorpus.includes('quiz')) {
    category = 'exam_announcement';
  } else if (textCorpus.includes('tuition') || textCorpus.includes('payment') || textCorpus.includes('fee')) {
    category = 'financial_requirement';
  } else if (textCorpus.includes('visa') || textCorpus.includes('immigration') || textCorpus.includes('i-20')) {
    category = 'visa_immigration';
  } else if (textCorpus.includes('scholarship') || textCorpus.includes('award')) {
    category = 'scholarship';
  } else if (textCorpus.includes('action required') || textCorpus.includes('mandatory')) {
    category = 'action_required';
  } else if (textCorpus.includes('registration') || textCorpus.includes('enrollment')) {
    category = 'administrative_deadline';
  }

  // Clean conversational summary instead of raw subject noise
  let cleanSubject = msg.subject
    .replace(/^Re:\s*/i, '')
    .replace(/^Fwd:\s*/i, '')
    .trim();

  let summary = cleanSubject;
  if (category === 'class_schedule_change') {
    summary = `Schedule update: ${cleanSubject}`;
  } else if (category === 'assignment_deadline') {
    summary = `Academic deadline: ${cleanSubject}`;
  } else if (category === 'action_required') {
    summary = `Action required: ${cleanSubject}`;
  } else if (category === 'financial_requirement') {
    summary = `Financial notice: ${cleanSubject}`;
  }

  const d = new Date(msg.internalDateMs);
  const timeString = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateKey = d.toISOString().split('T')[0];

  const finalScore = Math.max(0, Math.min(100, score));
  const isHighPriority = finalScore >= config.minimumImportanceThreshold;
  const actionRequired = finalScore >= 75 || textCorpus.includes('action required') || textCorpus.includes('mandatory');

  return {
    id: `email_${msg.id}`,
    accountEmail,
    sender: msg.sender,
    senderEmail: msg.senderEmail,
    subject: cleanSubject,
    summary,
    category,
    score: finalScore,
    isHighPriority,
    actionRequired,
    receivedAt: msg.internalDateMs,
    timeString,
    dateKey,
    signalsMatched: matchedSignals,
  };
}

/**
 * Filter and sort emails, returning only those meeting the strict importance threshold.
 */
export function rankImportantEmails(
  rawMessages: RawGmailMessageSummary[],
  accountEmail: string,
  config: EmailIntelligenceRuleConfig = DEFAULT_EMAIL_RULES
): ScoredEmailInsight[] {
  const scored = rawMessages.map((m) => scoreEmailMessage(m, accountEmail, config));
  return scored
    .filter((s) => s.isHighPriority)
    .sort((a, b) => b.score - a.score || b.receivedAt - a.receivedAt);
}
