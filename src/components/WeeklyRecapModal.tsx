import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Calendar, CreditCard, CheckCircle2, TrendingUp, TrendingDown } from 'lucide-react';
import { WeeklyRecapData } from '../types/activity';
import { triggerHaptic } from '../utils/haptics';

interface WeeklyRecapModalProps {
  isOpen: boolean;
  onClose: () => void;
  recap: WeeklyRecapData | null;
}

export const WeeklyRecapModal: React.FC<WeeklyRecapModalProps> = ({ isOpen, onClose, recap }) => {
  if (!isOpen) return null;

  const handleClose = () => {
    triggerHaptic('light');
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm cursor-pointer"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 350 }}
          className="relative w-full sm:max-w-md bg-[#F2F2F7] dark:bg-neutral-900 rounded-t-[28px] sm:rounded-[24px] shadow-2xl border border-black/[0.08] dark:border-white/[0.1] overflow-hidden max-h-[85vh] flex flex-col"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between bg-white/70 dark:bg-neutral-900/80 backdrop-blur-md">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
                Weekly Overview
              </span>
              <h2 className="text-[18px] font-semibold text-neutral-900 dark:text-neutral-50">
                Weekly Recap
              </h2>
              {recap?.weekRange && (
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  {recap.weekRange}
                </p>
              )}
            </div>

            <button
              onClick={handleClose}
              className="w-9 h-9 rounded-full bg-neutral-200/80 dark:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5">
            {!recap ? (
              <div className="py-8 text-center text-[13px] text-neutral-500">
                Compiling past 7 days summary…
              </div>
            ) : (
              <>
                {/* 1. Schedule & Commitments */}
                <div className="p-3.5 rounded-2xl bg-white dark:bg-neutral-800/70 border border-black/[0.04] dark:border-white/[0.06] flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 grow">
                    <div className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                      {recap.classesAndEventsCount} commitments tracked
                    </div>
                    <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                      Scheduled classes and appointments across the week
                    </div>
                  </div>
                </div>

                {/* 2. Family Ledger & Spending */}
                <div className="p-3.5 rounded-2xl bg-white dark:bg-neutral-800/70 border border-black/[0.04] dark:border-white/[0.06] flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 grow">
                    <div className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                      ¥{recap.totalSpendingJpy.toLocaleString()}
                      {recap.totalSpendingInr > 0 && ` + ₹${recap.totalSpendingInr.toLocaleString()}`}
                    </div>
                    <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                      Across {recap.transactionCount} transactions recorded in SpendIQ
                    </div>
                  </div>
                </div>

                {/* 3. Completed Life Admin Tasks */}
                <div className="p-3.5 rounded-2xl bg-white dark:bg-neutral-800/70 border border-black/[0.04] dark:border-white/[0.06] flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 grow">
                    <div className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                      {recap.completedRemindersCount} tasks marked complete
                    </div>
                    <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                      Personal life admin & travel planning items
                    </div>
                  </div>
                </div>

                {/* 4. Watchlist Stock Highlights */}
                {recap.keyStockMoves && recap.keyStockMoves.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-neutral-800/70 border border-black/[0.04] dark:border-white/[0.06]">
                    <div className="text-[12px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
                      Key Stock Watchlist Moves (±3% threshold)
                    </div>
                    <div className="space-y-1.5">
                      {recap.keyStockMoves.map((m) => {
                        const isUp = m.changePct >= 0;
                        return (
                          <div
                            key={m.symbol}
                            className="flex items-center justify-between text-[13px] py-1 border-b border-black/[0.03] dark:border-white/[0.04] last:border-0"
                          >
                            <span className="font-medium text-neutral-800 dark:text-neutral-200">
                              {m.name}
                            </span>
                            <span
                              className={`font-semibold tabular-nums flex items-center gap-1 ${
                                isUp
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {isUp ? (
                                <TrendingUp className="w-3.5 h-3.5" />
                              ) : (
                                <TrendingDown className="w-3.5 h-3.5" />
                              )}
                              {isUp ? '+' : ''}
                              {m.changePct.toFixed(1)}% · ₹{m.price.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.08] bg-white/70 dark:bg-neutral-900/80">
            <button
              onClick={handleClose}
              className="w-full py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-[14px] hover:opacity-90 active:scale-98 transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
