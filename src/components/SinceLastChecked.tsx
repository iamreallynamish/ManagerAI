import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { History, Check, Sparkles, TrendingUp, CreditCard, Calendar, GraduationCap } from 'lucide-react';
import { SinceLastCheckedItem } from '../types/activity';
import { triggerHaptic } from '../utils/haptics';

interface SinceLastCheckedProps {
  items: SinceLastCheckedItem[];
  onMarkChecked: () => void;
}

export const SinceLastChecked: React.FC<SinceLastCheckedProps> = ({ items, onMarkChecked }) => {
  if (!items || items.length === 0) return null;

  const handleDismiss = () => {
    triggerHaptic('light');
    onMarkChecked();
  };

  const getItemIcon = (source: string) => {
    switch (source) {
      case 'spend_iq':
        return <CreditCard className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />;
      case 'calendar':
        return <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />;
      case 'classroom':
        return <GraduationCap className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
      case 'stocks':
        return <TrendingUp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />;
    }
  };

  return (
    <AnimatePresence>
      <motion.section
        layout
        initial={{ opacity: 0, y: -4, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, height: 0, margin: 0, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 450, damping: 35 }}
        className="max-w-xl mx-auto w-full px-4 pt-2 pb-2"
      >
        <div className="rounded-2xl bg-neutral-900/[0.04] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
              <span className="text-[12px] font-semibold tracking-wide text-neutral-700 dark:text-neutral-300">
                Since you last checked
              </span>
            </div>

            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={handleDismiss}
              className="min-h-[32px] px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 transition-colors flex items-center gap-1 cursor-pointer"
              aria-label="Mark all as reviewed"
            >
              <Check className="w-3 h-3 text-neutral-500 dark:text-neutral-400" />
              <span>Mark reviewed</span>
            </motion.button>
          </div>

          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2.5 pl-0.5 text-[13px] leading-snug"
              >
                <div className="w-5 h-5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                  {getItemIcon(item.source)}
                </div>
                <div className="min-w-0 grow">
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span className="text-neutral-500 dark:text-neutral-400 ml-1.5 font-normal">
                      · {item.subtitle}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>
    </AnimatePresence>
  );
};
