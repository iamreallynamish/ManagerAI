import React from 'react';
import { motion } from 'motion/react';
import { KairoActivity } from '../types/activity';
import { TimelineItem } from './TimelineItem';

interface DateSectionProps {
  dateHeader: string;
  activities: KairoActivity[];
  isLastSection: boolean;
}

export const DateSection: React.FC<DateSectionProps> = ({
  dateHeader,
  activities,
  isLastSection,
}) => {
  const isTomorrow = dateHeader === 'TOMORROW';
  const isToday = dateHeader === 'TODAY';

  return (
    <motion.section
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mb-4"
    >
      {/* Sticky Section Header — Continuous surface without card boxes */}
      <div className="sticky top-11 sm:top-12 z-20 backdrop-blur-xl bg-[#F2F2F7]/90 dark:bg-black/90 py-2 px-1 mb-2 flex items-center justify-between gap-3 transition-colors">
        <div className="flex items-center gap-2">
          <h2
            className={`text-[12px] font-semibold tracking-wider uppercase ${
              isToday
                ? 'text-neutral-900 dark:text-neutral-100 font-bold'
                : isTomorrow
                ? 'text-blue-600 dark:text-blue-400 font-bold'
                : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            {dateHeader}
          </h2>
          {isTomorrow && (
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-blue-500/12 text-blue-700 dark:text-blue-300">
              Tomorrow Preview
            </span>
          )}
          {isToday && (
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              Today
            </span>
          )}
        </div>
        <div className="grow h-px bg-neutral-300/50 dark:bg-neutral-800/70 ml-2" />
      </div>

      {/* Seamless timeline items for this date */}
      <div className="space-y-0.5">
        {activities.map((activity, index) => {
          const isLastInDate = index === activities.length - 1;
          const isVeryLast = isLastSection && isLastInDate;
          return (
            <TimelineItem
              key={activity.id}
              activity={activity}
              isLast={isVeryLast}
            />
          );
        })}
      </div>
    </motion.section>
  );
};
