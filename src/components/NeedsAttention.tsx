import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plane, GraduationCap, BookmarkCheck, Check, ExternalLink, Compass } from 'lucide-react';
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
  if (!items || items.length === 0) return null;

  const handleAction = (item: AttentionItem) => {
    if (!item.actionId) return;
    if (item.actionType === 'confirm_flights' && onConfirmFlights) {
      triggerHaptic('success');
      onConfirmFlights(item.actionId);
    } else if (onCompleteReminder) {
      triggerHaptic('success');
      onCompleteReminder(item.actionId);
    }
  };

  return (
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

      {/* Gentle, unboxed living surface rows with fluid spring animation */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {items.map((item) => {
            const isFlight = item.title.toLowerCase().includes('flight') || item.type === 'travel_prep';
            const isAssignment = item.type === 'assignment_due';

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
                        : 'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400'
                    }`}
                  >
                    {isFlight ? (
                      <Plane className="w-4 h-4 stroke-[2]" />
                    ) : isAssignment ? (
                      <GraduationCap className="w-4 h-4 stroke-[2]" />
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

                {/* Contextual actions: never auto-completed, meeting 44×44pt touch area */}
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
                      onClick={() => handleAction(item)}
                      className={`min-h-[36px] px-3.5 flex items-center gap-1.5 text-[12px] font-semibold rounded-full transition-colors cursor-pointer ${
                        item.actionType === 'confirm_flights'
                          ? 'text-sky-700 dark:text-sky-300 bg-sky-500/15 dark:bg-sky-500/25 hover:bg-sky-500/25'
                          : 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 dark:bg-emerald-500/20 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30'
                      }`}
                      title={item.actionType === 'confirm_flights' ? 'Confirm flights are booked' : 'Mark task as completed'}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>{item.actionType === 'confirm_flights' ? 'Flights Booked' : 'Done'}</span>
                    </motion.button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
};
