import React from 'react';
import { motion } from 'motion/react';
import { Calendar, Sparkles } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface EmptyStateProps {
  onConnectCalendar?: () => void;
  isCalendarConnected: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  onConnectCalendar,
  isCalendarConnected,
}) => {
  const handleConnect = () => {
    triggerHaptic('light');
    onConnectCalendar?.();
  };

  return (
    <div className="py-14 px-6 text-center max-w-sm mx-auto">
      <div className="w-13 h-13 mx-auto rounded-full bg-neutral-200/60 dark:bg-neutral-800/60 text-neutral-500 dark:text-neutral-400 flex items-center justify-center mb-3">
        <Sparkles className="w-6 h-6 stroke-[1.8]" />
      </div>
      <h3 className="text-[17px] font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
        Your feed is clear
      </h3>
      <p className="text-[14px] text-neutral-500 dark:text-neutral-400 leading-relaxed mb-4">
        {isCalendarConnected
          ? 'You have no scheduled appointments, classes, or transactions for this period.'
          : 'Your schedule is currently clear. Connect your Google account to sync calendar events and coursework.'}
      </p>

      {!isCalendarConnected && onConnectCalendar && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleConnect}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-[14px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-xs transition-colors cursor-pointer"
        >
          <Calendar className="w-4 h-4 stroke-[2]" />
          <span>Connect Google Account</span>
        </motion.button>
      )}
    </div>
  );
};
