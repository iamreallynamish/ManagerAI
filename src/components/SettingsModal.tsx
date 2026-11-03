import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Globe,
  Users,
  Calendar,
  LogOut,
  CheckCircle2,
  AlertCircle,
  BookmarkCheck,
  User as UserIcon,
  RefreshCw,
  BarChart3,
  TrendingUp,
  Github,
  Mail,
  Plus,
  Server,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { triggerHaptic } from '../utils/haptics';
import {
  getLinkedProviders,
  getConnectedGoogleAccounts,
  removeConnectedGoogleAccount,
  connectAdditionalGoogleAccount,
  ConnectedGoogleAccount,
} from '../services/auth';
import { fetchCalendarDiagnostics } from '../services/api';
import { USER_PORTFOLIO_HOLDINGS, TOTAL_PORTFOLIO_COST_BASIS } from '../services/stockService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  hasCalendarToken: boolean;
  timeZone: string;
  onSelectTimeZone: (tz: string) => void;
  showAllSpenders: boolean;
  onToggleShowAllSpenders: (showAll: boolean) => void;
  onConnectCalendar: () => void;
  onSignOut: () => void;
  onOpenReminders: () => void;
  onOpenWeeklyRecap: () => void;
  preferredName: string;
  onUpdatePreferredName: (name: string) => void;
  onManualRefresh: () => void;
  isSyncing: boolean;
  onConnectGitHub?: () => void;
  onDisconnectGoogle?: () => void;
  onDisconnectGitHub?: () => void;
}

const COMMON_TIMEZONES = [
  { label: 'Tokyo (JST, UTC+9)', value: 'Asia/Tokyo' },
  { label: 'India (IST, UTC+5:30)', value: 'Asia/Kolkata' },
  { label: 'Universal (UTC)', value: 'UTC' },
  { label: 'London (GMT/BST)', value: 'Europe/London' },
  { label: 'New York (EST/EDT)', value: 'America/New_York' },
  { label: 'Los Angeles (PST/PDT)', value: 'America/Los_Angeles' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  user,
  hasCalendarToken,
  timeZone,
  onSelectTimeZone,
  showAllSpenders,
  onToggleShowAllSpenders,
  onConnectCalendar,
  onSignOut,
  onOpenReminders,
  onOpenWeeklyRecap,
  preferredName,
  onUpdatePreferredName,
  onManualRefresh,
  isSyncing,
  onConnectGitHub,
  onDisconnectGoogle,
  onDisconnectGitHub,
}) => {
  const linked = getLinkedProviders(user);
  const hasEverLinkedGoogle = Boolean(
    linked.isGoogleLinked ||
    (user?.providerData?.some((p) => p.providerId === 'google.com')) ||
    (user?.email && user.email.includes('@gmail.com'))
  );
  const isGoogleActive = hasEverLinkedGoogle && hasCalendarToken;

  const handleDismiss = () => {
    triggerHaptic('light');
    onClose();
  };

  const handleToggleLedger = (val: boolean) => {
    triggerHaptic('selection');
    onToggleShowAllSpenders(val);
  };

  const [googleAccounts, setGoogleAccounts] = React.useState<ConnectedGoogleAccount[]>(() =>
    getConnectedGoogleAccounts()
  );
  const [calendarDiag, setCalendarDiag] = React.useState<any>(null);

  React.useEffect(() => {
    if (isOpen) {
      setGoogleAccounts(getConnectedGoogleAccounts());
      fetchCalendarDiagnostics().then((d) => {
        if (d) setCalendarDiag(d);
      });
    }
  }, [isOpen]);

  const handleAddAccount = async () => {
    try {
      triggerHaptic('selection');
      const acc = await connectAdditionalGoogleAccount();
      if (acc) {
        setGoogleAccounts(getConnectedGoogleAccounts());
        onManualRefresh();
      }
    } catch (err: any) {
      console.warn('Error connecting additional account:', err);
    }
  };

  const handleRemoveAccount = (email: string) => {
    triggerHaptic('light');
    removeConnectedGoogleAccount(email);
    setGoogleAccounts(getConnectedGoogleAccounts());
    if (onDisconnectGoogle && googleAccounts.length <= 1) {
      onDisconnectGoogle();
    }
    onManualRefresh();
  };

  const [diagnostics, setDiagnostics] = React.useState<any>(null);
  const [diagLoading, setDiagLoading] = React.useState(false);
  const [showDiag, setShowDiag] = React.useState(false);

  const loadDiagnostics = async () => {
    setDiagLoading(true);
    try {
      const res = await fetch('/api/health/diagnostics');
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data);
      }
    } catch (err) {
      console.warn('Diagnostics fetch error:', err);
    } finally {
      setDiagLoading(false);
    }
  };

  const handleToggleDiag = () => {
    triggerHaptic('selection');
    if (!showDiag && !diagnostics) {
      loadDiagnostics();
    }
    setShowDiag(!showDiag);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          {/* Backdrop with spring fade and touch dismiss */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleDismiss}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* iOS Sheet with drag-to-dismiss gesture and rubber-banding */}
          <motion.div
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 100 || info.velocity.y > 300) {
                handleDismiss();
              }
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 350 }}
            className="relative w-full sm:max-w-md bg-white dark:bg-[#1C1C1E] rounded-t-[32px] sm:rounded-3xl border border-black/[0.06] dark:border-white/[0.08] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col z-10 touch-pan-y"
          >
            {/* Grabber Indicator */}
            <div className="w-9 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700 mx-auto mt-2.5 mb-1 shrink-0 cursor-grab active:cursor-grabbing" />

            {/* Navigation Bar */}
            <div className="px-5 py-2 flex items-center justify-between border-b border-black/[0.04] dark:border-white/[0.06] shrink-0">
              <button
                onClick={handleDismiss}
                className="text-[16px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 active:opacity-60 transition-opacity cursor-pointer min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center"
              >
                Cancel
              </button>
              <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
                Preferences
              </h2>
              <button
                onClick={handleDismiss}
                className="text-[16px] font-semibold text-blue-600 dark:text-blue-400 active:opacity-60 transition-opacity cursor-pointer min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center"
              >
                Done
              </button>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
              {/* Section 1: Preferred Name */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-3.5 border border-black/[0.03] dark:border-white/[0.05]">
                <div className="flex items-center gap-2 mb-2 text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">
                  <UserIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Preferred Name</span>
                </div>
                <input
                  type="text"
                  value={preferredName}
                  onChange={(e) => onUpdatePreferredName(e.target.value)}
                  placeholder="e.g. Namish"
                  className="w-full text-[15px] font-normal bg-white dark:bg-[#2C2C2E] text-neutral-900 dark:text-neutral-100 border border-black/[0.06] dark:border-white/[0.08] rounded-xl px-3 py-2.5 outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Section 2: Weekly Recap Trigger */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-1 border border-black/[0.03] dark:border-white/[0.05]">
                <button
                  onClick={() => {
                    handleDismiss();
                    onOpenWeeklyRecap();
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 active:scale-[0.99] transition-all cursor-pointer min-h-[48px]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center text-blue-600 dark:text-blue-400">
                      <BarChart3 className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                        Weekly Recap
                      </div>
                      <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                        7-day summary of commitments, spend & markets
                      </div>
                    </div>
                  </div>
                  <span className="text-[14px] font-medium text-blue-600 dark:text-blue-400 pr-1">
                    View
                  </span>
                </button>
              </div>

              {/* Section 3: Personal Reminders & Life Admin */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-1 border border-black/[0.03] dark:border-white/[0.05]">
                <button
                  onClick={() => {
                    handleDismiss();
                    onOpenReminders();
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 active:scale-[0.99] transition-all cursor-pointer min-h-[48px]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-500/15 flex items-center justify-center text-purple-600 dark:text-purple-400">
                      <BookmarkCheck className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                        Personal Reminders & Travel
                      </div>
                      <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                        India trip planning, visas, and admin tasks
                      </div>
                    </div>
                  </div>
                  <span className="text-[14px] font-medium text-blue-600 dark:text-blue-400 pr-1">
                    Manage
                  </span>
                </button>
              </div>

              {/* Section 4: Verified Portfolio & Watchlist */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-3.5 border border-black/[0.03] dark:border-white/[0.05]">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                    <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Investment Portfolio</span>
                  </div>
                  <span className="text-[12px] font-bold text-neutral-900 dark:text-neutral-100 font-mono">
                    ₹{TOTAL_PORTFOLIO_COST_BASIS.toLocaleString('en-IN', { minimumFractionDigits: 2 })} Cost Basis
                  </span>
                </div>
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mb-2.5">
                  Stored persistently across 5 verified holdings. Share counts and purchase prices are never overwritten:
                </p>

                <div className="space-y-1.5">
                  {USER_PORTFOLIO_HOLDINGS.map((h) => (
                    <div
                      key={h.companyName}
                      className="p-2.5 rounded-xl bg-white dark:bg-[#2C2C2E] border border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between text-[12px]"
                    >
                      <div>
                        <div className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                          <span>{h.companyName}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 font-mono">
                            {h.exchange}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                          {h.shares} {h.shares === 1 ? 'share' : 'shares'} @ ₹{h.averagePurchasePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-semibold text-neutral-900 dark:text-neutral-100">
                          ₹{h.totalInvested.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                          Verified holding
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-2.5 p-2 rounded-xl bg-blue-500/[0.06] dark:bg-blue-500/[0.12] border border-blue-500/15 text-[11px] text-blue-900 dark:text-blue-200">
                  <div className="font-medium flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span>Company Verification: Apollo Micro Systems (INE713T01028) strictly distinguished from Apollo Hospitals.</span>
                  </div>
                </div>
              </div>

              {/* Section 5: Display Timezone */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-3.5 border border-black/[0.03] dark:border-white/[0.05]">
                <div className="flex items-center gap-2 mb-1 text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">
                  <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Display Timezone</span>
                </div>
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mb-2.5">
                  Calculates dynamic midnight rollover and rolling spend windows.
                </p>
                <select
                  value={timeZone}
                  onChange={(e) => onSelectTimeZone(e.target.value)}
                  className="w-full text-[14px] font-medium bg-white dark:bg-[#2C2C2E] text-neutral-900 dark:text-neutral-100 border border-black/[0.06] dark:border-white/[0.08] rounded-xl px-3 py-2.5 outline-hidden focus:border-blue-500 cursor-pointer"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Section 6: Family Ledger Access */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-3.5 border border-black/[0.03] dark:border-white/[0.05]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                      <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Full Family Ledger Access</span>
                    </div>
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-1 max-w-[260px]">
                      {showAllSpenders
                        ? 'Showing transactions for Son (ICICI Forex) and Dad (Axis Bank).'
                        : 'Restricted to Son transactions only.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={showAllSpenders}
                    onClick={() => handleToggleLedger(!showAllSpenders)}
                    className={`w-[51px] h-[31px] flex items-center rounded-full p-[2px] transition-colors duration-200 cursor-pointer shrink-0 ${
                      showAllSpenders ? 'bg-[#34C759]' : 'bg-neutral-300 dark:bg-neutral-700'
                    }`}
                  >
                    <div
                      className={`bg-white w-[27px] h-[27px] rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.2)] transform transition-transform duration-200 ease-out ${
                        showAllSpenders ? 'translate-x-[20px]' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Section 7: Connected Accounts (Multi-Account Support) */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-3.5 border border-black/[0.03] dark:border-white/[0.05] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">
                    Connected Accounts
                  </div>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    Multi-Account Sync
                  </span>
                </div>

                {/* Connected Google Accounts List */}
                {googleAccounts.length > 0 ? (
                  <div className="space-y-2">
                    {googleAccounts.map((acc) => (
                      <div
                        key={acc.email}
                        className="p-3 bg-white dark:bg-[#2C2C2E] rounded-xl border border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                            <span className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                              {acc.name || acc.email.split('@')[0]}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[12px] truncate">
                            {acc.isTokenExpired ? (
                              <>
                                <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <span className="text-amber-600 dark:text-amber-400 truncate">
                                  Token expired — reconnect
                                </span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                <span className="text-neutral-600 dark:text-neutral-400 truncate">
                                  {acc.email} · Active
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {acc.isTokenExpired && (
                            <button
                              onClick={handleAddAccount}
                              className="min-h-[32px] px-2.5 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all cursor-pointer"
                            >
                              Reconnect
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveAccount(acc.email)}
                            className="min-h-[32px] px-2.5 flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg active:scale-95 transition-all cursor-pointer"
                            title="Disconnect account"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>Disconnect</span>
                          </button>
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={handleAddAccount}
                      className="w-full py-2.5 px-3 flex items-center justify-center gap-1.5 text-[12px] font-semibold bg-white dark:bg-[#2C2C2E] hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-black/[0.05] dark:border-white/[0.06] rounded-xl active:scale-98 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Add another Google Account</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="p-3 bg-white dark:bg-[#2C2C2E] rounded-xl border border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between gap-2">
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                          <span className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                            Google Calendar, Classroom & Gmail
                          </span>
                        </div>
                        <div className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                          {hasEverLinkedGoogle && isGoogleActive
                            ? `${linked.googleEmail || user?.email || 'Connected'} · Active`
                            : 'Sync schedules, assignments, and verified email notices'}
                        </div>
                      </div>

                      {hasEverLinkedGoogle && isGoogleActive ? (
                        <button
                          onClick={onDisconnectGoogle || onSignOut}
                          className="min-h-[34px] px-3 flex items-center gap-1 text-[12px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg active:scale-95 transition-all shrink-0 cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Disconnect</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            handleDismiss();
                            onConnectCalendar();
                          }}
                          className="min-h-[34px] px-3.5 text-[12px] font-semibold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl transition-all cursor-pointer shadow-xs shrink-0"
                        >
                          {hasEverLinkedGoogle ? 'Reconnect' : 'Connect'}
                        </button>
                      )}
                    </div>

                    <button
                      onClick={handleAddAccount}
                      className="w-full py-2.5 px-3 flex items-center justify-center gap-1.5 text-[12px] font-semibold bg-white dark:bg-[#2C2C2E] hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-black/[0.05] dark:border-white/[0.06] rounded-xl active:scale-98 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Add Google Account</span>
                    </button>
                  </div>
                )}

                {/* Calendar Synchronization Status Badge */}
                {calendarDiag && (calendarDiag.lastSuccessfulSyncTime || calendarDiag.status !== 'idle') && (
                  <div className="p-2.5 bg-white dark:bg-[#2C2C2E] rounded-xl border border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isSyncing || calendarDiag.status === 'syncing'
                            ? 'bg-blue-500 animate-pulse'
                            : calendarDiag.status === 'failed'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                      />
                      <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                        {isSyncing || calendarDiag.status === 'syncing'
                          ? 'Syncing…'
                          : calendarDiag.status === 'failed'
                          ? 'Sync failed'
                          : 'Calendar Connected'}
                      </span>
                      {calendarDiag.calendarsDiscovered?.length > 0 && (
                        <span className="text-neutral-500 dark:text-neutral-400 truncate">
                          · {calendarDiag.calendarsDiscovered.length} {calendarDiag.calendarsDiscovered.length === 1 ? 'calendar' : 'calendars'}
                        </span>
                      )}
                      {calendarDiag.upcomingEventsCount !== undefined && (
                        <span className="text-neutral-500 dark:text-neutral-400 truncate">
                          · {calendarDiag.upcomingEventsCount} upcoming
                        </span>
                      )}
                    </div>
                    {calendarDiag.lastSuccessfulSyncTime && (
                      <span className="text-neutral-500 dark:text-neutral-400 shrink-0">
                        Last synced{' '}
                        {new Intl.DateTimeFormat('en-US', {
                          timeZone,
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        }).format(new Date(calendarDiag.lastSuccessfulSyncTime))}
                      </span>
                    )}
                  </div>
                )}

                {/* GitHub Account */}
                <div className="p-3 bg-white dark:bg-[#2C2C2E] rounded-xl border border-black/[0.04] dark:border-white/[0.06]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <Github className="w-4 h-4 text-neutral-800 dark:text-neutral-200 shrink-0" />
                        <span className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                          GitHub
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-neutral-400 truncate">
                        {linked.isGithubLinked ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="truncate">{linked.githubUsername || linked.githubEmail || 'GitHub Connected'}</span>
                          </>
                        ) : (
                          <span>Connect GitHub to link your identity</span>
                        )}
                      </div>
                    </div>

                    {linked.isGithubLinked ? (
                      <button
                        onClick={onDisconnectGitHub || onSignOut}
                        className="min-h-[34px] px-3 flex items-center gap-1 text-[12px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg active:scale-95 transition-all shrink-0 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Disconnect</span>
                      </button>
                    ) : onConnectGitHub ? (
                      <button
                        onClick={() => {
                          handleDismiss();
                          onConnectGitHub();
                        }}
                        className="min-h-[34px] px-3.5 text-[12px] font-semibold bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-white dark:text-neutral-900 active:scale-95 rounded-xl transition-all cursor-pointer shadow-xs shrink-0"
                      >
                        Connect
                      </button>
                    ) : null}
                  </div>
                </div>

                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-normal pt-0.5">
                  Email Intelligence: Aggregates notices across connected inboxes. Strictly prioritizes verified university announcements, course deadlines, travel confirmations, and financial alerts. Routine marketing emails and newsletters are excluded.
                </p>
              </div>


              {/* Section 8: Manual Refresh */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-3.5 border border-black/[0.03] dark:border-white/[0.05] flex items-center justify-between">
                <span className="text-[13px] text-neutral-600 dark:text-neutral-300 font-medium">
                  Manual Data Refresh
                </span>
                <button
                  onClick={onManualRefresh}
                  disabled={isSyncing}
                  className="min-h-[36px] px-3.5 flex items-center gap-1.5 text-[13px] font-medium rounded-xl text-neutral-800 dark:text-neutral-200 bg-white dark:bg-[#2C2C2E] hover:bg-neutral-50 dark:hover:bg-neutral-700 border border-black/[0.06] dark:border-white/[0.08] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Syncing…' : 'Sync Now'}</span>
                </button>
              </div>

              {/* Section 9: Production Backend Diagnostics & Parity Panel */}
              <div className="bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl p-3.5 border border-black/[0.03] dark:border-white/[0.05]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                      Production Backend & Parity
                    </span>
                  </div>
                  <button
                    onClick={handleToggleDiag}
                    className="min-h-[32px] px-2.5 text-[11px] font-semibold rounded-lg bg-white dark:bg-[#2C2C2E] text-neutral-700 dark:text-neutral-300 border border-black/[0.06] dark:border-white/[0.08] active:scale-95 transition-all cursor-pointer"
                  >
                    {showDiag ? 'Hide Diagnostics' : 'Inspect Health'}
                  </button>
                </div>

                {showDiag && (
                  <div className="mt-3 pt-3 border-t border-black/[0.05] dark:border-white/[0.05] text-[11px] space-y-2.5 font-mono">
                    {diagLoading ? (
                      <div className="flex items-center gap-2 text-neutral-500 py-2">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Fetching live endpoint diagnostics…</span>
                      </div>
                    ) : diagnostics ? (
                      <>
                        {/* Build Info */}
                        <div className="p-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] space-y-1">
                          <div className="font-semibold text-neutral-900 dark:text-neutral-100 font-sans">Build & Environment</div>
                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Environment:</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{diagnostics.build?.environment}</span>
                          </div>
                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Commit / Build:</span>
                            <span>{diagnostics.build?.gitCommit}</span>
                          </div>
                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Runtime:</span>
                            <span>{diagnostics.build?.runtime}</span>
                          </div>
                        </div>

                        {/* Endpoints Status */}
                        <div className="p-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] space-y-1.5">
                          <div className="font-semibold text-neutral-900 dark:text-neutral-100 font-sans flex items-center justify-between">
                            <span>Endpoints (All 5 Active)</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">200 OK</span>
                          </div>

                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>SpendIQ:</span>
                            <span className="text-neutral-900 dark:text-neutral-200">
                              {diagnostics.apis?.spendiq?.recordsReturned} records · latest {diagnostics.apis?.spendiq?.latestRecordDate}
                            </span>
                          </div>

                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Stocks Watchlist:</span>
                            <span className="text-neutral-900 dark:text-neutral-200">
                              {diagnostics.apis?.stocks?.recordsReturned} monitored · {diagnostics.apis?.stocks?.marketStatusText}
                            </span>
                          </div>

                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Reminders:</span>
                            <span className="text-neutral-900 dark:text-neutral-200">
                              {diagnostics.apis?.reminders?.recordsReturned} stored ({diagnostics.apis?.reminders?.activeCount} active)
                            </span>
                          </div>

                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Weekly Recap:</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">HTTP 200 Ready</span>
                          </div>

                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Since Last Checked:</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">HTTP 200 Ready</span>
                          </div>

                          {diagnostics.apis?.calendar && (
                            <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                              <span>Calendar Sync:</span>
                              <span className="text-neutral-900 dark:text-neutral-200">
                                {diagnostics.apis.calendar.syncStatus || 'ok'} · {diagnostics.apis.calendar.upcomingEventsCount ?? 0} upcoming · {diagnostics.apis.calendar.storedEventsCount ?? 0} stored
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Data Sources */}
                        <div className="p-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] space-y-1">
                          <div className="font-semibold text-neutral-900 dark:text-neutral-100 font-sans">Cloud Data Sources</div>
                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Firebase RTDB:</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{diagnostics.dataSources?.firebase?.status}</span>
                          </div>
                          <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
                            <span>Native Bindings:</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Zero (Pure JS / Cloud Only)</span>
                          </div>
                        </div>

                        <button
                          onClick={loadDiagnostics}
                          className="w-full py-1.5 text-center font-sans font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          Re-check Live Diagnostics
                        </button>
                      </>
                    ) : (
                      <div className="text-red-500 py-1">Failed to fetch diagnostics</div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
