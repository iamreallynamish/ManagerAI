import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plane, GraduationCap, BookmarkCheck, Check, ExternalLink, Mail, AlertTriangle } from 'lucide-react';
import { AttentionItem } from '../types/activity';
import { triggerHaptic } from '../utils/haptics';

interface NeedsAttentionProps {
  items: AttentionItem[];
  onCompleteReminder?: (reminderId: string) => void;
  onConfirmFlights?: (reminderId: string) => void;
}

export const NeedsAttention: React.FC<NeedsAttentionProps> = ({
  items,
  onCompleteReminder,
  onConfirmFlights,
}) => {
  const [confirmingFlightId, setConfirmingFlightId] = useState<string | null>(null);

  if (!items || items.length === 0) return null;

  const handleActionClick = (item: AttentionItem) => {
    if (!item.actionId) return;

    if (item.actionType === 'confirm_flights') {
      // Open interactive confirmation dialog - never infer or auto-complete
      triggerHaptic('selection');
      setConfirmingFlightId(item.actionId);
    } else if (onCompleteReminder) {
      triggerHaptic('success');
      onCompleteReminder(item.actionId);
    }
  };

  const handleExplicitFlightConfirm = () => {
    if (confirmingFlightId && onConfirmFlights) {
      triggerHaptic('success');
      onConfirmFlights(confirmingFlightId);
    }
    setConfirmingFlightId(null);
  };

  return (
    <>
      <section className="px-4 pb-4 max-w-xl mx-auto w-full">
        {/* Calm, conversational section title */}
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h2 className="text-[12px] font-semibold tracking-wider uppercase text-neutral-500 dark:text-neutral-400">
            Worth remembering
          </h2>
          <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {/* Gentle living surface rows with fluid spring animation */}
        <div className="space-y-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {items.map((item) => {
              const isFlight = item.title.toLowerCase().includes('flight') || item.type === 'travel_prep';
              const isAssignment = item.type === 'assignment_due';
              const isEmail = item.type === 'email_action';

              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className="group flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-black/[0.08] dark:hover:border-white/[0.1] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        isFlight
                          ? 'bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400'
                          : isAssignment
                          ? 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400'
                          : isEmail
                          ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
                          : 'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400'
                      }`}
                    >
                      {isFlight ? (
                        <Plane className="w-4 h-4 stroke-[2]" />
                      ) : isAssignment ? (
                        <GraduationCap className="w-4 h-4 stroke-[2]" />
                      ) : isEmail ? (
                        <Mail className="w-4 h-4 stroke-[2]" />
                      ) : (
                        <BookmarkCheck className="w-4 h-4 stroke-[2]" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-[14px] sm:text-[15px] font-medium text-neutral-900 dark:text-neutral-100 leading-snug">
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div className="text-[12px] sm:text-[13px] text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Contextual actions: explicit interactive flow */}
                  <div className="flex items-center gap-1.5 shrink-0 -mr-1">
                    {item.link && (
                      <motion.a
                        whileTap={{ scale: 0.92 }}
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-full transition-colors"
                        title="Open details"
                        aria-label="Open source details"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </motion.a>
                    )}
                    {item.actionId && (
                      <motion.button
                        whileTap={{ scale: 0.94 }}
                        onClick={() => handleActionClick(item)}
                        className={`min-h-[36px] px-3.5 flex items-center gap-1.5 text-[12px] font-semibold rounded-full transition-colors cursor-pointer ${
                          item.actionType === 'confirm_flights'
                            ? 'text-sky-700 dark:text-sky-300 bg-sky-500/15 dark:bg-sky-500/25 hover:bg-sky-500/25'
                            : 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 dark:bg-emerald-500/20 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30'
                        }`}
                        title={item.actionType === 'confirm_flights' ? 'Mark flights as booked' : 'Mark task as completed'}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>{item.actionType === 'confirm_flights' ? 'Mark as booked' : 'Done'}</span>
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </section>

      {/* Explicit Interactive Confirmation Modal for Flight Booking */}
      <AnimatePresence>
        {confirmingFlightId && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmingFlightId(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              className="relative w-full max-w-sm bg-white dark:bg-[#1C1C1E] rounded-3xl p-5 border border-black/[0.08] dark:border-white/[0.1] shadow-2xl z-10 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                  <Plane className="w-5 h-5 stroke-[2]" />
                </div>
                <div>
                  <h3 className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
                    Mark flights as booked?
                  </h3>
                  <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                    Jan 5, 2027 – Apr 5, 2027
                  </p>
                </div>
              </div>

              <p className="text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                Are your flights to India confirmed and booked? Only confirm if you have completed the booking. This will update your persistent records.
              </p>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setConfirmingFlightId(null);
                  }}
                  className="min-h-[40px] px-4 text-[13px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExplicitFlightConfirm}
                  className="min-h-[40px] px-4 text-[13px] font-semibold bg-sky-600 hover:bg-sky-700 active:scale-95 text-white rounded-xl transition-all cursor-pointer shadow-xs"
                >
                  Yes, mark as booked
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
