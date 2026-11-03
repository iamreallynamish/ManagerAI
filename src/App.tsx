import { useState, useEffect, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { Header } from './components/Header';
import { UpNext } from './components/UpNext';
import { DailyBriefing } from './components/DailyBriefing';
import { SinceLastChecked } from './components/SinceLastChecked';
import { NeedsAttention } from './components/NeedsAttention';
import { DateSection } from './components/DateSection';
import { EmptyState } from './components/EmptyState';
import { SettingsModal } from './components/SettingsModal';
import { LifeAdminModal } from './components/LifeAdminModal';
import { WeeklyRecapModal } from './components/WeeklyRecapModal';
import {
  KairoActivity,
  ClassroomAssignment,
  PersonalReminder,
  SinceLastCheckedItem,
  WeeklyRecapData,
  StockQuote,
} from './types/activity';
import {
  fetchSpendIqActivities,
  syncGoogleCalendar,
  syncGoogleClassroom,
  syncGmail,
  fetchStockWatchlist,
  fetchSinceLastChecked,
  markUserChecked,
  fetchWeeklyRecap,
  mergeAndSortActivities,
} from './services/api';
import {
  initAuth,
  googleSignIn,
  githubSignIn,
  disconnectGoogle,
  disconnectGithub,
  logout,
  getAccessToken,
  getConnectedGoogleAccounts,
  markAccountTokenExpired,
} from './services/auth';
import {
  getReminders,
  saveReminder,
  toggleReminder,
  confirmFlights,
  deleteReminder,
} from './services/reminders';
import { synthesizeBriefing } from './services/briefingEngine';
import { ScoredEmailInsight } from './services/emailIntelligence';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);

  // Multi-source activities
  const [spendActivities, setSpendActivities] = useState<KairoActivity[]>([]);
  const [calendarActivities, setCalendarActivities] = useState<KairoActivity[]>([]);
  const [classroomActivities, setClassroomActivities] = useState<KairoActivity[]>([]);
  const [classroomAssignments, setClassroomAssignments] = useState<ClassroomAssignment[]>([]);
  const [stockActivities, setStockActivities] = useState<KairoActivity[]>([]);
  const [stockQuotes, setStockQuotes] = useState<StockQuote[]>([]);
  const [emailActivities, setEmailActivities] = useState<KairoActivity[]>([]);
  const [emailInsights, setEmailInsights] = useState<ScoredEmailInsight[]>([]);
  const [reminders, setReminders] = useState<PersonalReminder[]>([]);

  // Awareness state
  const [sinceLastCheckedItems, setSinceLastCheckedItems] = useState<SinceLastCheckedItem[]>([]);
  const [scheduleGapNote, setScheduleGapNote] = useState<string | undefined>(undefined);
  const [spendingContext, setSpendingContext] = useState<{
    todaySpentJpy: number;
    todaySpentInr: number;
    todayTxCount: number;
  } | undefined>(undefined);
  const [weeklyRecapData, setWeeklyRecapData] = useState<WeeklyRecapData | null>(null);

  // UI state
  const [isSyncing, setIsSyncing] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accountConflict, setAccountConflict] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRemindersOpen, setIsRemindersOpen] = useState(false);
  const [isWeeklyRecapOpen, setIsWeeklyRecapOpen] = useState(false);

  // Preferred Name (auto-detects or defaults to 'Namish')
  const [preferredName, setPreferredName] = useState<string>(() => {
    try {
      return localStorage.getItem('kairo_preferred_name') || 'Namish';
    } catch {
      return 'Namish';
    }
  });

  // Timezone preference (defaults to device timezone or Asia/Tokyo)
  const [timeZone, setTimeZone] = useState<string>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
    } catch {
      return 'Asia/Tokyo';
    }
  });

  // Access rule: user explicitly selected "All transactions in the family ledger"
  const [showAllSpenders, setShowAllSpenders] = useState(true);

  // 1. Load Spend IQ transactions
  const loadSpendIqData = useCallback(async (tz: string, showAll: boolean) => {
    try {
      const data = await fetchSpendIqActivities({
        timeZone: tz,
        showAllSpenders: showAll,
      });
      setSpendActivities(data.activities);
      if (data.spendingContext) {
        setSpendingContext({
          todaySpentJpy: data.spendingContext.todaySpentJpy,
          todaySpentInr: data.spendingContext.todaySpentInr,
          todayTxCount: data.spendingContext.todayTxCount,
        });
      }
      return data.activities;
    } catch (err: any) {
      console.warn('Spend IQ fetch notice:', err);
      return [];
    }
  }, []);

  // 2. Load Stock Watchlist (meaningful moves >= ±3%)
  const loadStockData = useCallback(async (tz: string) => {
    try {
      const { quotes, activities } = await fetchStockWatchlist(tz);
      setStockActivities(activities);
      setStockQuotes(quotes);
      return activities;
    } catch (err) {
      console.warn('Failed to load stock data:', err);
      return [];
    }
  }, []);

  // 3. Load Since You Last Checked
  const loadSinceLastChecked = useCallback(async (userId?: string) => {
    try {
      const res = await fetchSinceLastChecked(userId || 'default');
      if (res.hasChanges) {
        setSinceLastCheckedItems(res.items);
      } else {
        setSinceLastCheckedItems([]);
      }
    } catch (err) {
      console.warn('Failed to load since last checked:', err);
    }
  }, []);

  // 4. Load Google Calendar, Classroom & Gmail across all connected accounts
  const loadGoogleData = useCallback(async (token: string, tz: string) => {
    try {
      const storedAccounts = getConnectedGoogleAccounts();
      const accountsToSync = storedAccounts.length > 0
        ? storedAccounts
        : [{ email: 'primary', accessToken: token, id: 'primary', name: 'Primary Account', connectedAt: Date.now() }];

      const allCalActs: KairoActivity[] = [];
      const allClassActs: KairoActivity[] = [];
      const allAssignments: ClassroomAssignment[] = [];
      const allEmailActs: KairoActivity[] = [];
      const allEmailInsights: ScoredEmailInsight[] = [];
      let latestGapNote: string | undefined = undefined;

      await Promise.all(
        accountsToSync.map(async (acc) => {
          if (!acc.accessToken) return;
          try {
            const [calResult, classResult, gmailResult] = await Promise.all([
              syncGoogleCalendar(acc.accessToken, { timeZone: tz }).catch((e: any) => {
                if (e?.message?.includes('401')) {
                  markAccountTokenExpired(acc.email, true);
                }
                return { activities: [], scheduleGapNote: undefined };
              }),
              syncGoogleClassroom(acc.accessToken, { timeZone: tz }).catch((e: any) => {
                if (e?.message?.includes('401')) {
                  markAccountTokenExpired(acc.email, true);
                }
                return { assignments: [], activities: [] };
              }),
              syncGmail(acc.accessToken, { timeZone: tz, accountEmail: acc.email }).catch((e: any) => {
                if (e?.message?.includes('401')) {
                  markAccountTokenExpired(acc.email, true);
                }
                return { insights: [], activities: [] };
              }),
            ]);

            if (calResult.activities) allCalActs.push(...calResult.activities);
            if (calResult.scheduleGapNote) latestGapNote = calResult.scheduleGapNote;
            if (classResult.activities) allClassActs.push(...classResult.activities);
            if (classResult.assignments) allAssignments.push(...classResult.assignments);
            if (gmailResult.activities) allEmailActs.push(...gmailResult.activities);
            if (gmailResult.insights) allEmailInsights.push(...gmailResult.insights);
          } catch (accErr) {
            console.warn(`Sync error for account ${acc.email}:`, accErr);
          }
        })
      );

      // Deduplicate calendar activities by id
      const uniqueCalMap = new Map<string, KairoActivity>();
      for (const act of allCalActs) uniqueCalMap.set(act.id, act);
      setCalendarActivities(Array.from(uniqueCalMap.values()));
      setScheduleGapNote(latestGapNote);

      // Deduplicate classroom assignments by id
      const uniqueAssnMap = new Map<string, ClassroomAssignment>();
      for (const assn of allAssignments) uniqueAssnMap.set(assn.id, assn);
      setClassroomAssignments(Array.from(uniqueAssnMap.values()));

      // Deduplicate classroom activities by id
      const uniqueClassActMap = new Map<string, KairoActivity>();
      for (const act of allClassActs) uniqueClassActMap.set(act.id, act);
      setClassroomActivities(Array.from(uniqueClassActMap.values()));

      // Deduplicate email activities by id
      const uniqueEmailActMap = new Map<string, KairoActivity>();
      for (const act of allEmailActs) uniqueEmailActMap.set(act.id, act);
      setEmailActivities(Array.from(uniqueEmailActMap.values()));

      // Deduplicate email insights
      const uniqueInsightMap = new Map<string, ScoredEmailInsight>();
      for (const ins of allEmailInsights) uniqueInsightMap.set(ins.id, ins);
      setEmailInsights(Array.from(uniqueInsightMap.values()));

      setHasGoogleToken(true);
      return true;
    } catch (err: any) {
      console.warn('Failed to sync Google accounts:', err);
      setHasGoogleToken(false);
      return null;
    }
  }, []);

  // 5. Load Personal Reminders & Travel Plans
  const loadRemindersData = useCallback(async (userId?: string) => {
    try {
      const items = await getReminders(userId);
      setReminders(items);
      return items;
    } catch (err) {
      console.warn('Failed to load reminders:', err);
      return [];
    }
  }, []);

  // 6. Load Weekly Recap Data
  const loadWeeklyRecap = useCallback(async (tz: string) => {
    try {
      const data = await fetchWeeklyRecap(tz);
      setWeeklyRecapData(data);
    } catch (err) {
      console.warn('Failed to load weekly recap:', err);
    }
  }, []);

  // 7. Combined Refresh
  const handleRefresh = useCallback(async () => {
    setIsSyncing(true);
    setErrorMessage(null);
    try {
      await Promise.all([
        loadSpendIqData(timeZone, showAllSpenders),
        loadStockData(timeZone),
        loadRemindersData(user?.uid),
        loadSinceLastChecked(user?.uid),
        loadWeeklyRecap(timeZone),
      ]);
      const token = getAccessToken();
      if (token) {
        await loadGoogleData(token, timeZone);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [
    loadSpendIqData,
    loadStockData,
    loadGoogleData,
    loadRemindersData,
    loadSinceLastChecked,
    loadWeeklyRecap,
    timeZone,
    showAllSpenders,
    user?.uid,
  ]);

  // Initial Boot & Auth listener
  useEffect(() => {
    let mounted = true;

    const unsubscribe = initAuth(
      async (authUser, token) => {
        if (!mounted) return;
        setUser(authUser);
        if (authUser?.displayName) {
          const firstName = authUser.displayName.split(' ')[0];
          if (firstName && !localStorage.getItem('kairo_preferred_name')) {
            setPreferredName(firstName);
          }
        }
        await loadRemindersData(authUser.uid);
        if (token) {
          setHasGoogleToken(true);
          await loadGoogleData(token, timeZone);
        } else {
          setHasGoogleToken(false);
        }
      },
      () => {
        if (!mounted) return;
        setUser(null);
        setHasGoogleToken(false);
        setCalendarActivities([]);
        setClassroomActivities([]);
        setClassroomAssignments([]);
      }
    );

    Promise.all([
      loadSpendIqData(timeZone, showAllSpenders),
      loadStockData(timeZone),
      loadRemindersData(),
      loadSinceLastChecked(),
      loadWeeklyRecap(timeZone),
    ]).finally(() => {
      if (mounted) setIsInitialLoading(false);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [
    loadSpendIqData,
    loadStockData,
    loadGoogleData,
    loadRemindersData,
    loadSinceLastChecked,
    loadWeeklyRecap,
    timeZone,
    showAllSpenders,
  ]);

  // Connect Google Account (supports linking with existing GitHub session)
  const handleConnectGoogle = async (options?: { forceDirectSignIn?: boolean }) => {
    try {
      setIsSyncing(true);
      setErrorMessage(null);
      setAccountConflict(false);
      const res = await googleSignIn(options);
      if (res && res.user) {
        setUser(res.user);
        if (res.user?.displayName && !localStorage.getItem('kairo_preferred_name')) {
          const firstName = res.user.displayName.split(' ')[0];
          if (firstName) setPreferredName(firstName);
        }
        const effectiveToken = res.accessToken || getAccessToken();
        if (effectiveToken) {
          setHasGoogleToken(true);
          await loadGoogleData(effectiveToken, timeZone);
        }
        await loadRemindersData(res.user.uid);
      }
    } catch (err: any) {
      if (
        err?.code !== 'auth/popup-closed-by-user' &&
        err?.code !== 'auth/cancelled-popup-request'
      ) {
        console.error('Google sign-in notice:', err);
        if (err?.isAccountConflict) {
          setAccountConflict(true);
        } else {
          setErrorMessage(err.message || 'Google sign-in could not be completed.');
        }
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Connect GitHub Account (supports linking with Google session)
  const handleConnectGitHub = async () => {
    try {
      setIsSyncing(true);
      setErrorMessage(null);
      const res = await githubSignIn();
      if (res && res.user) {
        setUser(res.user);
        if (res.user?.displayName && !localStorage.getItem('kairo_preferred_name')) {
          const firstName = res.user.displayName.split(' ')[0];
          if (firstName) setPreferredName(firstName);
        }
        await loadRemindersData(res.user.uid);
      }
    } catch (err: any) {
      if (
        err?.code !== 'auth/popup-closed-by-user' &&
        err?.code !== 'auth/cancelled-popup-request'
      ) {
        console.error('GitHub sign-in failed:', err);
        setErrorMessage(err.message || 'GitHub sign-in could not be completed.');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    const updatedUser = await disconnectGoogle();
    setUser(updatedUser);
    setHasGoogleToken(false);
    setCalendarActivities([]);
    setClassroomActivities([]);
    setClassroomAssignments([]);
  };

  const handleDisconnectGitHub = async () => {
    const updatedUser = await disconnectGithub();
    setUser(updatedUser);
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setHasGoogleToken(false);
    setCalendarActivities([]);
    setClassroomActivities([]);
    setClassroomAssignments([]);
    setIsSettingsOpen(false);
  };

  // Periodic check for local midnight date change in user's timezone
  useEffect(() => {
    let lastDateKey = '';
    try {
      lastDateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      lastDateKey = new Date().toISOString().split('T')[0];
    }

    const interval = setInterval(() => {
      let currentDateKey = '';
      try {
        currentDateKey = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());
      } catch {
        currentDateKey = new Date().toISOString().split('T')[0];
      }

      if (currentDateKey && lastDateKey && currentDateKey !== lastDateKey) {
        lastDateKey = currentDateKey;
        handleRefresh();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [timeZone, handleRefresh]);

  // Preferred name updater
  const handleUpdatePreferredName = (newName: string) => {
    setPreferredName(newName);
    try {
      localStorage.setItem('kairo_preferred_name', newName);
    } catch {}
  };

  // Reminders Actions
  const handleAddReminder = async (rem: PersonalReminder) => {
    await saveReminder(rem, user?.uid);
    await loadRemindersData(user?.uid);
  };

  const handleToggleReminder = async (id: string, completed: boolean) => {
    const updated = await toggleReminder(id, completed, user?.uid);
    setReminders([...updated]);
  };

  const handleConfirmFlightsAction = async (id: string) => {
    const updated = await confirmFlights(id, user?.uid);
    setReminders([...updated]);
  };

  const handleDeleteReminder = async (id: string) => {
    const updated = await deleteReminder(id, user?.uid);
    setReminders([...updated]);
  };

  // Dismiss "Since You Last Checked"
  const handleMarkChecked = async () => {
    setSinceLastCheckedItems([]);
    await markUserChecked(user?.uid || 'default');
  };

  // 1. Dynamic Daily Briefing & Up Next synthesis
  const briefing = useMemo(() => {
    return synthesizeBriefing({
      userName: preferredName,
      timeZone,
      calendarActivities,
      assignments: classroomAssignments,
      reminders,
      scheduleGapNote,
      emailInsights,
      recentStockMoves: stockQuotes,
      todaySpendingContext: spendingContext,
    });
  }, [
    preferredName,
    timeZone,
    calendarActivities,
    classroomAssignments,
    reminders,
    scheduleGapNote,
    emailInsights,
    stockQuotes,
    spendingContext,
  ]);

  // Reminders activities for timeline in rolling 7-day window
  const reminderActivities = useMemo(() => {
    const acts: KairoActivity[] = [];
    const nowMs = Date.now();
    const sevenDaysAgoMs = nowMs - 7 * 86400000;
    for (const rem of reminders) {
      const occurredAt = rem.completed_at || rem.updated_at || rem.created_at;
      if (occurredAt >= sevenDaysAgoMs) {
        const d = new Date(occurredAt);
        const dateKey = d.toISOString().split('T')[0];
        const isCompleted = rem.status === 'completed' || rem.completed;
        acts.push({
          id: `rem_act_${rem.id}`,
          source: 'reminder',
          activityType: 'reminder',
          title: isCompleted ? `Completed: ${rem.title}` : `Active plan: ${rem.title}`,
          detail: rem.details || rem.context,
          relatedEntityId: rem.id,
          occurredAt,
          dateKey,
          dateHeader: d
            .toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' })
            .toUpperCase(),
          timeString: d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }),
        });
      }
    }
    return acts;
  }, [reminders, timeZone]);

  // 2. Merge and sort all activities across sources
  const allActivities = useMemo(() => {
    return mergeAndSortActivities(
      spendActivities,
      calendarActivities,
      classroomActivities,
      stockActivities,
      emailActivities,
      reminderActivities
    );
  }, [
    spendActivities,
    calendarActivities,
    classroomActivities,
    stockActivities,
    emailActivities,
    reminderActivities,
  ]);

  // 3. Strict 7-day rolling window: activities from now back to exactly 7 days ago
  const timelineActivities = useMemo(() => {
    const nowMs = Date.now();
    const sevenDaysAgoMs = nowMs - 7 * 86400000;
    return allActivities.filter((act) => {
      // Future previews (e.g. TOMORROW) are preserved
      if (act.occurredAt > nowMs) return true;
      // Past events are strictly limited to the rolling 7-day window
      return act.occurredAt >= sevenDaysAgoMs;
    });
  }, [allActivities]);

  // 4. Group timeline activities by dateHeader, prioritized: TOMORROW (preview) -> TODAY -> YESTERDAY -> Historical
  const groupedSections = useMemo(() => {
    const groupMap = new Map<string, { dateHeader: string; activities: KairoActivity[] }>();

    for (const act of timelineActivities) {
      if (!groupMap.has(act.dateHeader)) {
        groupMap.set(act.dateHeader, { dateHeader: act.dateHeader, activities: [] });
      }
      groupMap.get(act.dateHeader)!.activities.push(act);
    }

    const sections = Array.from(groupMap.values());

    sections.sort((a, b) => {
      if (a.dateHeader === 'TOMORROW') return -1;
      if (b.dateHeader === 'TOMORROW') return 1;
      if (a.dateHeader === 'TODAY') return -1;
      if (b.dateHeader === 'TODAY') return 1;
      if (a.dateHeader === 'YESTERDAY') return -1;
      if (b.dateHeader === 'YESTERDAY') return 1;
      const timeA = a.activities[0]?.occurredAt || 0;
      const timeB = b.activities[0]?.occurredAt || 0;
      return timeB - timeA;
    });

    return sections;
  }, [timelineActivities]);

  return (
    <div className="min-h-screen bg-[#F2F2F7] dark:bg-black text-neutral-900 dark:text-neutral-100 flex flex-col font-sans antialiased selection:bg-neutral-200 dark:selection:bg-neutral-800">
      {/* Minimal Header (Wordmark + Quiet Settings Icon) */}
      <Header onOpenSettings={() => setIsSettingsOpen(true)} />

      {/* 1. "Up Next" System (Single most relevant commitment) */}
      <UpNext item={briefing.upNext} />

      {/* 2. Personal Daily Briefing (Inline conversational typography, no hero box) */}
      <DailyBriefing
        greeting={briefing.greeting}
        sentences={briefing.sentences}
      />

      {/* 3. Since You Last Checked (Appears only when meaningful changes occurred) */}
      <SinceLastChecked
        items={sinceLastCheckedItems}
        onMarkChecked={handleMarkChecked}
      />

      {/* 4. Needs Your Attention (Actionable items only) */}
      <NeedsAttention
        items={briefing.attentionItems}
        onCompleteReminder={(id) => handleToggleReminder(id, true)}
        onConfirmFlights={handleConfirmFlightsAction}
      />

      {/* Optional error banner */}
      {errorMessage && (
        <div className="max-w-xl mx-auto px-4 w-full mb-3">
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-[13px] text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="w-8 h-8 -mr-1 flex items-center justify-center text-red-500 hover:text-red-700 dark:hover:text-red-200 font-bold active:scale-90 transition-transform cursor-pointer"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Account conflict seamless resolution banner */}
      {accountConflict && (
        <div className="max-w-xl mx-auto px-4 w-full mb-3">
          <div className="p-3.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-[13px] text-blue-900 dark:text-blue-100 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-blue-950 dark:text-blue-50">Google Account Notice</div>
              <div className="text-[12px] text-blue-800/80 dark:text-blue-200/80 mt-0.5">
                Your Google account is already registered separately. Tap to sign in directly (your GitHub link remains saved).
              </div>
            </div>
            <button
              onClick={() => handleConnectGoogle({ forceDirectSignIn: true })}
              className="min-h-[34px] px-3 text-[12px] font-semibold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl transition-all cursor-pointer shadow-xs shrink-0"
            >
              Sign In Directly
            </button>
          </div>
        </div>
      )}

      {/* 6. Recent Activity Timeline Feed */}
      <main className="grow max-w-xl mx-auto w-full px-3 sm:px-4 pb-safe-nav pt-1">
        {isInitialLoading ? (
          <div className="py-20 text-center">
            <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400 tracking-wide font-medium">
              Gathering your awareness feed…
            </p>
          </div>
        ) : allActivities.length === 0 ? (
          <EmptyState
            onConnectCalendar={handleConnectGoogle}
            isCalendarConnected={hasGoogleToken}
          />
        ) : (
          <div className="relative">
            <AnimatePresence mode="popLayout" initial={false}>
              {groupedSections.map((section, idx) => (
                <DateSection
                  key={section.dateHeader}
                  dateHeader={section.dateHeader}
                  activities={section.activities}
                  isLastSection={idx === groupedSections.length - 1}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Settings & Preferences Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
        hasCalendarToken={hasGoogleToken}
        timeZone={timeZone}
        onSelectTimeZone={setTimeZone}
        showAllSpenders={showAllSpenders}
        onToggleShowAllSpenders={setShowAllSpenders}
        onConnectCalendar={handleConnectGoogle}
        onConnectGitHub={handleConnectGitHub}
        onDisconnectGoogle={handleDisconnectGoogle}
        onDisconnectGitHub={handleDisconnectGitHub}
        onSignOut={handleSignOut}
        onOpenReminders={() => setIsRemindersOpen(true)}
        onOpenWeeklyRecap={() => setIsWeeklyRecapOpen(true)}
        preferredName={preferredName}
        onUpdatePreferredName={handleUpdatePreferredName}
        onManualRefresh={handleRefresh}
        isSyncing={isSyncing}
      />

      {/* Life Admin & Personal Reminders Modal */}
      <LifeAdminModal
        isOpen={isRemindersOpen}
        onClose={() => setIsRemindersOpen(false)}
        reminders={reminders}
        onAddReminder={handleAddReminder}
        onToggleComplete={handleToggleReminder}
        onDeleteReminder={handleDeleteReminder}
        onConfirmFlights={handleConfirmFlightsAction}
      />

      {/* Weekly Recap Modal */}
      <WeeklyRecapModal
        isOpen={isWeeklyRecapOpen}
        onClose={() => setIsWeeklyRecapOpen(false)}
        recap={weeklyRecapData}
      />
    </div>
  );
}
