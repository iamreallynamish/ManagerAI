import React from 'react';
import { motion } from 'motion/react';
import { ActivitySource } from '../types/activity';
import { triggerHaptic } from '../utils/haptics';

export type FilterValue = 'all' | ActivitySource;

interface FilterBarProps {
  currentFilter: FilterValue;
  onSelectFilter: (filter: FilterValue) => void;
  counts: {
    all: number;
    spend_iq: number;
    calendar: number;
    classroom: number;
    stocks: number;
  };
}

export const FilterBar: React.FC<FilterBarProps> = ({
  currentFilter,
  onSelectFilter,
  counts,
}) => {
  const tabs: { id: FilterValue; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'calendar', label: 'Calendar', count: counts.calendar },
    { id: 'classroom', label: 'Classroom', count: counts.classroom },
    { id: 'spend_iq', label: 'Spend IQ', count: counts.spend_iq },
    { id: 'stocks', label: 'Stocks', count: counts.stocks },
  ];

  const handleSelect = (tabId: FilterValue) => {
    if (tabId !== currentFilter) {
      triggerHaptic('selection');
      onSelectFilter(tabId);
    }
  };

  return (
    <nav className="px-4 pt-1 pb-3 max-w-xl mx-auto w-full" aria-label="Activity filter">
      <div className="relative flex items-center p-1 bg-neutral-200/70 dark:bg-neutral-800/60 backdrop-blur-md rounded-[12px] select-none border border-black/[0.04] dark:border-white/[0.05] overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = currentFilter === tab.id;
          return (
            <motion.button
              key={tab.id}
              whileTap={{ scale: 0.96 }}
              onClick={() => handleSelect(tab.id)}
              className="relative flex-1 min-w-[64px] min-h-[34px] sm:min-h-[36px] py-1 px-1 rounded-[9px] text-[12px] sm:text-[13px] font-medium flex items-center justify-center gap-1 cursor-pointer outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {/* Fluid sliding pill indicator */}
              {isActive && (
                <motion.div
                  layoutId="activeFilterPill"
                  className="absolute inset-0 bg-white dark:bg-[#636366] rounded-[9px] shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.06)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}

              {/* Text & Count label above sliding indicator */}
              <span
                className={`relative z-10 truncate transition-colors duration-150 ${
                  isActive
                    ? 'text-neutral-900 dark:text-white font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                {tab.label}
              </span>

              {tab.count > 0 && (
                <span
                  className={`relative z-10 text-[10px] sm:text-[11px] font-medium tabular-nums px-1 rounded-full transition-colors duration-150 ${
                    isActive
                      ? 'bg-neutral-100 dark:bg-neutral-900/60 text-neutral-700 dark:text-neutral-200'
                      : 'text-neutral-400 dark:text-neutral-500'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
};
