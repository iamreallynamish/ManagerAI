import React from 'react';
import { motion } from 'motion/react';
import { FilterValue } from './FilterBar';
import { Calendar, CreditCard, Clock, GraduationCap } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface EmptyStateProps {
  filter: FilterValue;
  onConnectCalendar?: () => void;
  isCalendarConnected: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  filter,
  onConnectCalendar,
  isCalendarConnected,
}) => {
  const handleConnect = () => {
    triggerHaptic('light');
    onConnectCalendar?.();
  };

  if (filter === 'calendar' && !isCalendarConnected) {
    return (
      <div className="py-14 px-6 text-center max-w-sm mx-auto">
        <div className="w-13 h-13 mx-auto rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
          <Calendar className="w-6 h-6 stroke-[1.8]" />
        </div>
        <h3 className="text-[17px] font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
          Google Calendar Disconnected
        </h3>
        <p className="text-[14px] text-neutral-500 dark:text-neutral-400 leading-relaxed mb-5">
          Connect your Google account with read-only access to view today and tomorrow's appointments and classes.
        </p>
        {onConnectCalendar && (
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
  }

  if (filter === 'classroom' && !isCalendarConnected) {
    return (
      <div className="py-14 px-6 text-center max-w-sm mx-auto">
        <div className="w-13 h-13 mx-auto rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
          <GraduationCap className="w-6 h-6 stroke-[1.8]" />
        </div>
        <h3 className="text-[17px] font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
          Google Classroom Disconnected
        </h3>
        <p className="text-[14px] text-neutral-500 dark:text-neutral-400 leading-relaxed mb-5">
          Connect your Google account with read-only Classroom permissions to track coursework, due dates, and assignments.
        </p>
        {onConnectCalendar && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={handleConnect}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-[14px] font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-2xl shadow-xs transition-colors cursor-pointer"
          >
            <GraduationCap className="w-4 h-4 stroke-[2]" />
            <span>Connect Google Account</span>
          </motion.button>
        )}
      </div>
    );
  }

  return (
    <div className="py-14 px-6 text-center max-w-sm mx-auto">
      <div className="w-13 h-13 mx-auto rounded-full bg-neutral-200/60 dark:bg-neutral-800/60 text-neutral-400 dark:text-neutral-500 flex items-center justify-center mb-3">
        {filter === 'spend_iq' ? (
          <CreditCard className="w-6 h-6 stroke-[1.8]" />
        ) : filter === 'calendar' ? (
          <Calendar className="w-6 h-6 stroke-[1.8]" />
        ) : filter === 'classroom' ? (
          <GraduationCap className="w-6 h-6 stroke-[1.8]" />
        ) : (
          <Clock className="w-6 h-6 stroke-[1.8]" />
        )}
      </div>
      <h3 className="text-[17px] font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
        No Activities Found
      </h3>
      <p className="text-[14px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
        {filter === 'spend_iq'
          ? 'No Spend IQ transactions match your current spender filter.'
          : filter === 'calendar'
          ? 'No calendar events found within the current daily window.'
          : filter === 'classroom'
          ? 'No published assignments or active course deadlines found.'
          : 'Your timeline is currently clear.'}
      </p>
    </div>
  );
};
