import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { effectiveFirebaseConfig } from './auth';

const app = getApps().length > 0 ? getApp() : initializeApp(effectiveFirebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
