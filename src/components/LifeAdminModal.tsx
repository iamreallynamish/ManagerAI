import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, Trash2, BookmarkCheck, Plane, AlertCircle } from 'lucide-react';
import {
  PersonalReminder,
  ReminderPriority,
  ReminderTargetFlexibility,
} from '../types/activity';
import { triggerHaptic } from '../utils/haptics';

interface LifeAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  reminders: PersonalReminder[];
  onAddReminder: (reminder: PersonalReminder) => void;
  onToggleComplete: (id: string, completed: boolean) => void;
  onDeleteReminder: (id: string) => void;
  onConfirmFlights?: (id: string) => void;
}

export const LifeAdminModal: React.FC<LifeAdminModalProps> = ({
  isOpen,
  onClose,
  reminders,
  onAddReminder,
  onToggleComplete,
  onDeleteReminder,
  onConfirmFlights,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [flexibility, setFlexibility] = useState<ReminderTargetFlexibility>('week_of');
  const [priority, setPriority] = useState<ReminderPriority>('medium');
  const [isTravel, setIsTravel] = useState(false);
  const [travelStart, setTravelStart] = useState('2027-01-05');
  const [travelEnd, setTravelEnd] = useState('2027-04-05');

  const handleDismiss = () => {
    triggerHaptic('light');
    onClose();
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    triggerHaptic('success');
    const now = Date.now();
    const newReminder: PersonalReminder = {
      id: `rem_${now}_${Math.random().toString(36).substring(2, 6)}`,
      user_id: 'default',
      title: title.trim(),
      details: details.trim() || undefined,
      target_date: targetDate || undefined,
      target_date_flexibility: flexibility,
      status: 'active',
      priority,
      created_at: now,
      updated_at: now,
      completed_at: null,
      is_travel: isTravel,
      flights_booked: false,
      travel_start_date: isTravel ? travelStart : undefined,
      travel_end_date: isTravel ? travelEnd : undefined,
      completed: false,
      context: details.trim() || undefined,
      dueDate: targetDate || undefined,
    };

    onAddReminder(newReminder);
    setTitle('');
    setDetails('');
    setTargetDate('');
    setIsTravel(false);
    setIsAdding(false);
  };

  const handleToggle = (id: string, status: boolean) => {
    triggerHaptic('success');
    onToggleComplete(id, status);
  };

  const handleDelete = (id: string) => {
    triggerHaptic('medium');
    onDeleteReminder(id);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          {/* Backdrop with touch dismiss */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleDismiss}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Sheet */}
          <motion.div
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 100 || info.velocity.y > 300) {
                handleDismiss();
              }
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 350 }}
            className="relative w-full sm:max-w-md bg-white dark:bg-[#1C1C1E] rounded-t-[32px] sm:rounded-3xl border border-black/[0.06] dark:border-white/[0.08] shadow-2xl overflow-hidden max-h-[88vh] flex flex-col z-10 touch-pan-y"
          >
            {/* Grabber */}
            <div className="w-9 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700 mx-auto mt-2.5 mb-1 shrink-0 cursor-grab active:cursor-grabbing" />

            {/* Navigation Bar */}
            <div className="px-5 py-2 flex items-center justify-between border-b border-black/[0.04] dark:border-white/[0.06] shrink-0">
              <button
                onClick={handleDismiss}
                className="text-[16px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 active:opacity-60 transition-opacity cursor-pointer min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center"
              >
                Cancel
              </button>
              <div className="flex items-center gap-1.5">
                <BookmarkCheck className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
                  Personal Reminders
                </h2>
              </div>
              <button
                onClick={handleDismiss}
                className="text-[16px] font-semibold text-blue-600 dark:text-blue-400 active:opacity-60 transition-opacity cursor-pointer min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center"
              >
                Done
              </button>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
              {/* Note on data rule */}
              <div className="px-3 py-2 rounded-xl bg-neutral-100/80 dark:bg-neutral-800/60 text-[12px] text-neutral-600 dark:text-neutral-300 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-neutral-500 shrink-0 mt-0.5" />
                <span>
                  Reminders are stored in your private backend database and never automatically marked complete until you check them off.
                </span>
              </div>

              {/* Add form */}
              {isAdding ? (
                <form
                  onSubmit={handleSave}
                  className="p-4 bg-neutral-100/70 dark:bg-neutral-900/60 rounded-2xl border border-black/[0.04] dark:border-white/[0.06] space-y-3"
                >
                  <div>
                    <label className="block text-[12px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                      Reminder Title
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Book India flights, Renew passport"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full text-[14px] px-3 py-2 rounded-xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] text-neutral-900 dark:text-neutral-100 outline-hidden focus:border-blue-500"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                      Context / Details
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Target window: Nov 8–21 · Outbound Jan 5"
                      value={details}
                      onChange={(e) => setDetails(e.target.value)}
                      className="w-full text-[14px] px-3 py-2 rounded-xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] text-neutral-900 dark:text-neutral-100 outline-hidden focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[12px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                        Target Date
                      </label>
                      <input
                        type="date"
                        value={targetDate}
                        onChange={(e) => setTargetDate(e.target.value)}
                        className="w-full text-[13px] px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] text-neutral-900 dark:text-neutral-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                        Date Flexibility
                      </label>
                      <select
                        value={flexibility}
                        onChange={(e) => setFlexibility(e.target.value as ReminderTargetFlexibility)}
                        className="w-full text-[13px] px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] text-neutral-900 dark:text-neutral-100"
                      >
                        <option value="exact">Exact day</option>
                        <option value="week_of">Week of</option>
                        <option value="month_of">Month of</option>
                        <option value="none">No specific date</option>
                      </select>
                    </div>
                  </div>

                  {/* Travel Toggle */}
                  <div className="pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
                      <input
                        type="checkbox"
                        checked={isTravel}
                        onChange={(e) => setIsTravel(e.target.checked)}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                      <Plane className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      <span>This is an upcoming travel trip</span>
                    </label>

                    {isTravel && (
                      <div className="mt-2.5 p-3 rounded-xl bg-sky-500/[0.06] border border-sky-500/15 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="block text-[11px] text-neutral-500">Departure</span>
                            <input
                              type="date"
                              value={travelStart}
                              onChange={(e) => setTravelStart(e.target.value)}
                              className="w-full text-[12px] px-2 py-1 rounded-lg bg-white dark:bg-[#2C2C2E] border"
                            />
                          </div>
                          <div>
                            <span className="block text-[11px] text-neutral-500">Return</span>
                            <input
                              type="date"
                              value={travelEnd}
                              onChange={(e) => setTravelEnd(e.target.value)}
                              className="w-full text-[12px] px-2 py-1 rounded-lg bg-white dark:bg-[#2C2C2E] border"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsAdding(false)}
                      className="min-h-[40px] px-3.5 text-[14px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/50 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!title.trim()}
                      className="min-h-[40px] px-4 text-[14px] font-semibold bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-xl disabled:opacity-40 active:scale-95 transition-all cursor-pointer shadow-xs"
                    >
                      Save Reminder
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setIsAdding(true)}
                  className="w-full min-h-[46px] flex items-center justify-center gap-2 py-2.5 px-4 bg-neutral-100/70 hover:bg-neutral-200/60 dark:bg-neutral-800/60 dark:hover:bg-neutral-800 rounded-2xl text-[14px] font-semibold text-blue-600 dark:text-blue-400 active:scale-[0.99] transition-all cursor-pointer border border-black/[0.03] dark:border-white/[0.05]"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>Add Personal Reminder</span>
                </button>
              )}

              {/* Reminders List */}
              <div className="space-y-2 pt-1">
                {reminders.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-[14px] text-neutral-500 dark:text-neutral-400">
                      No personal reminders added yet.
                    </p>
                    <p className="text-[12px] text-neutral-400 dark:text-neutral-500 mt-1">
                      Add key travel dates, flight bookings, or life admin tasks.
                    </p>
                  </div>
                ) : (
                  <AnimatePresence mode="popLayout" initial={false}>
                    {reminders.map((rem) => {
                      const isDone = rem.status === 'completed' || rem.completed;
                      const hasFlights = rem.flights_booked;

                      return (
                        <motion.div
                          key={rem.id}
                          layout
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                          className={`p-3.5 rounded-2xl border transition-all ${
                            isDone
                              ? 'bg-neutral-100/50 dark:bg-neutral-900/30 border-black/[0.02] dark:border-white/[0.03] opacity-60'
                              : 'bg-white dark:bg-[#2C2C2E] border-black/[0.04] dark:border-white/[0.06] shadow-xs'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              {/* 44×44pt tap target for toggle */}
                              <button
                                onClick={() => handleToggle(rem.id, !isDone)}
                                aria-label={isDone ? 'Mark uncompleted' : 'Mark completed'}
                                className="w-11 h-11 -ml-2 flex items-center justify-center rounded-full active:scale-90 transition-transform cursor-pointer shrink-0"
                              >
                                <div
                                  className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                                    isDone
                                      ? 'bg-[#34C759] border-[#34C759] text-white'
                                      : 'border-neutral-300 dark:border-neutral-600 hover:border-neutral-400'
                                  }`}
                                >
                                  {isDone && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                </div>
                              </button>

                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`text-[14px] sm:text-[15px] font-medium leading-snug ${
                                      isDone
                                        ? 'line-through text-neutral-400 dark:text-neutral-500'
                                        : 'text-neutral-900 dark:text-neutral-100'
                                    }`}
                                  >
                                    {rem.title}
                                  </span>

                                  {rem.is_travel && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-bold uppercase bg-sky-500/15 text-sky-700 dark:text-sky-300">
                                      <Plane className="w-2.5 h-2.5" />
                                      {hasFlights ? 'Flights confirmed' : 'Trip plan'}
                                    </span>
                                  )}
                                </div>

                                {(rem.details || rem.context) && (
                                  <div className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                                    {rem.details || rem.context}
                                  </div>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={() => handleDelete(rem.id)}
                              className="w-11 h-11 -mr-2 flex items-center justify-center text-neutral-400 hover:text-red-600 dark:hover:text-red-400 rounded-full active:scale-90 transition-all shrink-0 cursor-pointer"
                              title="Delete reminder"
                              aria-label="Delete reminder"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Quick action for flight confirmation if not booked yet */}
                          {rem.is_travel && !hasFlights && !isDone && onConfirmFlights && (
                            <div className="mt-2.5 pt-2 border-t border-black/[0.04] dark:border-white/[0.04] flex items-center justify-end">
                              <button
                                onClick={() => onConfirmFlights(rem.id)}
                                className="px-3 py-1 rounded-full bg-sky-500/15 hover:bg-sky-500/25 text-sky-700 dark:text-sky-300 text-[12px] font-semibold transition-colors cursor-pointer"
                              >
                                I've booked these flights
                              </button>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
