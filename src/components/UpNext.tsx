import React from 'react';
import { motion } from 'motion/react';
import { Calendar, GraduationCap, Plane, Clock, Bookmark, ArrowRight, ExternalLink } from 'lucide-react';
import { UpNextItem } from '../types/activity';
import { triggerHaptic } from '../utils/haptics';

interface UpNextProps {
  item: UpNextItem | null;
}

export const UpNext: React.FC<UpNextProps> = ({ item }) => {
  if (!item) return null;

  const getIcon = () => {
    switch (item.category) {
      case 'class':
        return <GraduationCap className="w-4 h-4 text-amber-600 dark:text-amber-400" strokeWidth={2.2} />;
      case 'assignment':
        return <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400" strokeWidth={2.2} />;
      case 'travel':
        return <Plane className="w-4 h-4 text-sky-600 dark:text-sky-400" strokeWidth={2.2} />;
      case 'reminder':
        return <Bookmark className="w-4 h-4 text-purple-600 dark:text-purple-400" strokeWidth={2.2} />;
      case 'event':
      default:
        return <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" strokeWidth={2.2} />;
    }
  };

  const getUrgencyBadge = () => {
    if (item.urgency === 'now') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Up next
        </span>
      );
    }
    if (item.urgency === 'today') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-300">
          Today
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
        Upcoming
      </span>
    );
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className="max-w-xl mx-auto w-full px-4 pt-4 pb-2"
    >
      <div className="relative overflow-hidden rounded-2xl bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] shadow-xs p-3.5 sm:p-4">
        {/* Subtle accent glow */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
              {getIcon()}
            </div>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
              Up Next
            </span>
          </div>
          {getUrgencyBadge()}
        </div>

        <div className="pl-1">
          <h2 className="text-[17px] sm:text-[18px] font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight leading-snug">
            {item.headline}
          </h2>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-neutral-600 dark:text-neutral-300 font-medium">
            <span className="text-neutral-900 dark:text-neutral-100 font-semibold">
              {item.contextTime}
            </span>
            {item.detail && (
              <>
                <span className="text-neutral-300 dark:text-neutral-700 select-none">·</span>
                <span className="text-neutral-500 dark:text-neutral-400 font-normal truncate max-w-[280px]">
                  {item.detail}
                </span>
              </>
            )}
          </div>
        </div>

        {item.link && (
          <div className="mt-3 pt-2.5 border-t border-black/[0.04] dark:border-white/[0.04] flex items-center justify-end">
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => triggerHaptic('light')}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:underline min-h-[36px] py-1 px-2"
            >
              <span>Open in Classroom</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </motion.section>
  );
};
