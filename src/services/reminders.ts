import { doc, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import { PersonalReminder, ReminderStatus } from '../types/activity';
import {
  fetchBackendReminders,
  saveBackendReminder,
  updateBackendReminderStatus,
  deleteBackendReminder,
  confirmBackendFlights,
} from './api';

const LOCAL_STORAGE_KEY = 'kairo_personal_reminders';

const DEFAULT_REMINDERS: PersonalReminder[] = [
  {
    id: 'rem_india_flights',
    user_id: 'default',
    title: 'Book India flights',
    details: 'Target booking window: Nov 8–21 · Outbound Jan 5, 2027, Return Apr 5, 2027',
    target_date: '2026-11-21',
    target_date_flexibility: 'week_of',
    status: 'active',
    priority: 'high',
    created_at: Date.now() - 86400000,
    updated_at: Date.now() - 86400000,
    completed_at: null,
    is_travel: true,
    flights_booked: false,
    travel_start_date: '2027-01-05',
    travel_end_date: '2027-04-05',
    completed: false,
    context: 'Target booking window: Nov 8–21 · Outbound Jan 5, Return Apr 5',
    dueDate: '2026-11-21',
  },
];

export async function getReminders(userId?: string): Promise<PersonalReminder[]> {
  // 1. Try Backend API first (persisted server-side in .data/kairo_store.json)
  try {
    const backendItems = await fetchBackendReminders(userId || 'default');
    if (backendItems && backendItems.length > 0) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(backendItems));
      return backendItems;
    }
  } catch (err) {
    console.warn('Backend reminders fetch failed:', err);
  }

  // 2. Try Firestore if authenticated
  if (userId && db) {
    try {
      const snap = await getDocs(collection(db, 'users', userId, 'reminders'));
      if (!snap.empty) {
        const items: PersonalReminder[] = [];
        snap.forEach((d) => items.push(d.data() as PersonalReminder));
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
        return items;
      }
    } catch (err) {
      console.warn('Firestore reminders fetch failed:', err);
    }
  }

  // 3. Local storage fallback
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_REMINDERS));
  return DEFAULT_REMINDERS;
}

export async function saveReminder(reminder: PersonalReminder, userId?: string): Promise<PersonalReminder[]> {
  const effectiveUserId = userId || 'default';
  reminder.user_id = effectiveUserId;
  reminder.updated_at = Date.now();
  if (!reminder.created_at) reminder.created_at = Date.now();

  // Save to backend
  await saveBackendReminder(reminder);

  // Sync to local
  const current = await getReminders(userId);
  const idx = current.findIndex((r) => r.id === reminder.id);
  if (idx >= 0) {
    current[idx] = reminder;
  } else {
    current.unshift(reminder);
  }
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(current));

  // Sync to Firestore if available
  if (userId && db) {
    try {
      await setDoc(doc(db, 'users', userId, 'reminders', reminder.id), reminder, { merge: true });
    } catch (err) {
      console.warn('Firestore reminder sync failed:', err);
    }
  }

  return current;
}

export async function toggleReminder(
  id: string,
  completed: boolean,
  userId?: string
): Promise<PersonalReminder[]> {
  const status: ReminderStatus = completed ? 'completed' : 'active';
  await updateBackendReminderStatus(id, status);

  const current = await getReminders(userId);
  const target = current.find((r) => r.id === id);
  if (target) {
    target.status = status;
    target.completed = completed;
    target.completed_at = completed ? Date.now() : null;
    target.updated_at = Date.now();
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(current));
    if (userId && db) {
      try {
        await setDoc(doc(db, 'users', userId, 'reminders', id), {
          status,
          completed,
          completed_at: target.completed_at,
          updated_at: target.updated_at,
        }, { merge: true });
      } catch (err) {
        console.warn('Firestore toggle failed:', err);
      }
    }
  }
  return current;
}

export async function confirmFlights(id: string, userId?: string): Promise<PersonalReminder[]> {
  await confirmBackendFlights(id);
  const current = await getReminders(userId);
  const target = current.find((r) => r.id === id);
  if (target) {
    target.flights_booked = true;
    target.details = 'Flights confirmed! Outbound Jan 5, 2027 · Return Apr 5, 2027. Next: packing & travel checklist.';
    target.context = target.details;
    target.updated_at = Date.now();
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(current));
  }
  return current;
}

export async function deleteReminder(id: string, userId?: string): Promise<PersonalReminder[]> {
  await deleteBackendReminder(id);
  let current = await getReminders(userId);
  current = current.filter((r) => r.id !== id);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(current));
  if (userId && db) {
    try {
      await deleteDoc(doc(db, 'users', userId, 'reminders', id));
    } catch (err) {
      console.warn('Firestore delete failed:', err);
    }
  }
  return current;
}
