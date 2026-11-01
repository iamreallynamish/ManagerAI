import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CreditCard,
  Calendar,
  GraduationCap,
  BookmarkCheck,
  Sparkles,
  ExternalLink,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  Clock,
} from 'lucide-react';
import { KairoActivity } from '../types/activity';
import { triggerHaptic } from '../utils/haptics';

interface TimelineItemProps {
  activity: KairoActivity;
  isLast: boolean;
}

export const TimelineItem: React.FC<TimelineItemProps> = ({ activity, isLast }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isSpend = activity.source === 'spend_iq';
  const isCalendar = activity.source === 'calendar';
  const isClassroom = activity.source === 'classroom';
  const isStock = activity.source === 'stocks';
  const isReminder = activity.source === 'reminder';
  const isSummary = activity.activityType === 'calendar_summary';
  const isEmptyCalendar = activity.activityType === 'calendar_empty';
  const isGrouped = !!activity.isGrouped && !!activity.subTransactions?.length;

  const handleToggleGroup = () => {
    triggerHaptic('selection');
    setIsExpanded((prev) => !prev);
  };

  const isStockGain = activity.stockData ? activity.stockData.changePct >= 0 : true;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
      className={`group relative flex items-start gap-3 sm:gap-3.5 pl-1 ${isSummary ? 'my-1' : ''}`}
    >
      {/* 1. Left-aligned timestamp column */}
      <div className="w-13 sm:w-15 shrink-0 pt-0.5 text-right select-none">
        <span
          className={`font-mono tabular-nums text-[12px] sm:text-[13px] font-medium ${
            isSummary
              ? 'text-blue-600 dark:text-blue-400 font-semibold'
              : 'text-neutral-400 dark:text-neutral-500'
          }`}
        >
          {activity.timeString}
        </span>
      </div>

      {/* 2. Timeline rail with circular source node */}
      <div className="relative flex flex-col items-center self-stretch shrink-0 select-none">
        <div
          className={`z-10 w-6 h-6 rounded-full flex items-center justify-center border transition-transform duration-150 group-hover:scale-105 ${
            isSummary
              ? 'bg-blue-600 text-white border-blue-600 dark:bg-blue-500 shadow-xs'
              : isEmptyCalendar
              ? 'bg-neutral-100 text-neutral-400 border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800'
              : isSpend
              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30'
              : isCalendar
              ? 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30'
              : isClassroom
              ? 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30'
              : isStock
              ? isStockGain
                ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/25 dark:text-emerald-400'
                : 'bg-rose-500/15 text-rose-600 border-rose-500/25 dark:bg-rose-500/25 dark:text-rose-400'
              : 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30'
          }`}
          title={
            isSummary
              ? 'Daily calendar summary'
              : isSpend
              ? 'Spend IQ transaction'
              : isCalendar
              ? 'Google Calendar event'
              : isClassroom
              ? 'Google Classroom assignment'
              : isStock
              ? 'Watchlist stock movement'
              : 'Personal reminder'
          }
        >
          {isSummary && <Sparkles className="w-3 h-3 stroke-[2.2]" />}
          {isEmptyCalendar && <CheckCircle className="w-3 h-3" />}
          {!isSummary && !isEmptyCalendar && isSpend && <CreditCard className="w-3 h-3 stroke-[2]" />}
          {!isSummary && !isEmptyCalendar && isCalendar && <Calendar className="w-3 h-3 stroke-[2]" />}
          {!isSummary && !isEmptyCalendar && isClassroom && <GraduationCap className="w-3 h-3 stroke-[2]" />}
          {!isSummary && !isEmptyCalendar && isStock && (
            isStockGain ? <TrendingUp className="w-3 h-3 stroke-[2.2]" /> : <TrendingDown className="w-3 h-3 stroke-[2.2]" />
          )}
          {!isSummary && !isEmptyCalendar && !isSpend && !isCalendar && !isClassroom && !isStock && (
            <BookmarkCheck className="w-3 h-3 stroke-[2]" />
          )}
        </div>

        {/* Vertical connecting line */}
        {!isLast && (
          <div className="w-[1.5px] grow bg-neutral-200 dark:bg-neutral-800 my-1 rounded-full" />
        )}
      </div>

      {/* 3. Activity content container */}
      <div className={`grow pb-4 pt-0.5 min-w-0 pr-1 ${!isLast ? '' : 'pb-1'}`}>
        <div className="flex items-start justify-between gap-2">
          {/* Natural language activity title */}
          <div
            className={`leading-snug break-words ${
              isSummary
                ? 'text-[14px] sm:text-[15px] font-medium text-blue-950 dark:text-blue-100 bg-blue-500/[0.06] dark:bg-blue-500/[0.12] p-3 rounded-2xl border border-blue-500/15'
                : isEmptyCalendar
                ? 'text-[13px] text-neutral-500 dark:text-neutral-400 italic'
                : 'text-[14px] sm:text-[15px] font-medium text-neutral-900 dark:text-neutral-100'
            }`}
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <span>{activity.title}</span>

              {/* Rescheduled badge */}
              {activity.isRescheduled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  Rescheduled
                </span>
              )}

              {/* Classroom countdown badge */}
              {activity.urgency === 'today' && (
                <span className="inline-flex items-center px-1.5 py-0.2 rounded-md text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-700 dark:text-red-300">
                  Due today
                </span>
              )}
              {activity.urgency === 'tomorrow' && (
                <span className="inline-flex items-center px-1.5 py-0.2 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  Due tomorrow
                </span>
              )}
            </div>
          </div>

          {/* External link with accessible 44×44pt touch area */}
          {activity.link && (
            <a
              href={activity.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open source"
              className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 active:scale-95 transition-all shrink-0 rounded-full"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Schedule gap note */}
        {activity.scheduleGapNote && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-blue-500/[0.08] dark:bg-blue-500/[0.14] text-[12px] font-medium text-blue-800 dark:text-blue-300 border border-blue-500/15">
            <Clock className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            <span>{activity.scheduleGapNote}</span>
          </div>
        )}

        {/* Metadata with subtle dot separators */}
        {activity.detail && !isSummary && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] sm:text-[13px] text-neutral-500 dark:text-neutral-400">
            {activity.detail.split(' · ').map((part, index) => (
              <React.Fragment key={index}>
                {index > 0 && <span className="text-neutral-300 dark:text-neutral-700 select-none">·</span>}
                <span
                  className={
                    index === 0 && activity.spender
                      ? 'font-medium text-neutral-700 dark:text-neutral-300'
                      : ''
                  }
                >
                  {part}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Grouped SpendIQ transactions disclosure */}
        {isGrouped && activity.subTransactions && (
          <div className="mt-2">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleToggleGroup}
              className="min-h-[36px] px-2.5 py-1 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[12px] font-medium text-neutral-600 dark:text-neutral-300 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>{isExpanded ? 'Hide individual purchases' : `View ${activity.subTransactions.length} individual purchases`}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </motion.button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className="overflow-hidden mt-2 space-y-1.5 pl-2 border-l border-neutral-200 dark:border-neutral-800"
                >
                  {activity.subTransactions.map((subTx) => {
                    const subTime = subTx.timestampMs
                      ? new Date(subTx.timestampMs).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : '';
                    const subAmt = subTx.amountJpy
                      ? `¥${subTx.amountJpy.toLocaleString()}`
                      : subTx.amountInr
                      ? `₹${subTx.amountInr.toLocaleString()}`
                      : '¥0';

                    return (
                      <div
                        key={subTx.id}
                        className="py-1 px-2.5 rounded-lg bg-white/70 dark:bg-neutral-900/60 border border-black/[0.03] dark:border-white/[0.04] text-[12px] flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-neutral-400">{subTime}</span>
                          <span className="text-neutral-700 dark:text-neutral-300">
                            {subTx.spender === 'Son' ? 'You' : subTx.spender} · {subTx.cardUsed || 'Card'}
                          </span>
                        </div>
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
                          {subAmt}
                        </span>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
};
