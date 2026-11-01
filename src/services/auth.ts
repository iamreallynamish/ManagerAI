import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  linkWithPopup,
  unlink,
  GoogleAuthProvider,
  GithubAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import rawFirebaseConfig from '../../firebase-applet-config.json';

// Support Vercel and standard environment variable overrides while falling back to firebase-applet-config.json
export const effectiveFirebaseConfig = {
  apiKey: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_API_KEY) || rawFirebaseConfig.apiKey,
  authDomain: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN) || rawFirebaseConfig.authDomain,
  projectId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_PROJECT_ID) || rawFirebaseConfig.projectId,
  storageBucket: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET) || rawFirebaseConfig.storageBucket,
  messagingSenderId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID) || rawFirebaseConfig.messagingSenderId,
  appId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_APP_ID) || rawFirebaseConfig.appId,
};

const app = getApps().length > 0 ? getApp() : initializeApp(effectiveFirebaseConfig);
export const auth = getAuth(app);

export const getAuthDomainInfo = () => {
  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return {
    currentHostname,
    authDomain: effectiveFirebaseConfig.authDomain,
    projectId: effectiveFirebaseConfig.projectId,
    isLocalhost: currentHostname === 'localhost' || currentHostname === '127.0.0.1',
  };
};

const GOOGLE_TOKEN_STORAGE_KEY = 'kairo_google_access_token';

// Configure Google Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/calendar.events.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Configure GitHub Provider
const githubProvider = new GithubAuthProvider();
githubProvider.addScope('read:user');
githubProvider.addScope('user:email');

let cachedAccessToken: string | null = null;

// Initialize cached access token from storage
try {
  cachedAccessToken =
    sessionStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY) ||
    localStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY);
} catch {
  cachedAccessToken = null;
}

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
  try {
    if (token) {
      sessionStorage.setItem(GOOGLE_TOKEN_STORAGE_KEY, token);
      localStorage.setItem(GOOGLE_TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
      localStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
    }
  } catch {}
};

export const getAccessToken = (): string | null => {
  if (cachedAccessToken) return cachedAccessToken;
  try {
    const stored =
      sessionStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY) ||
      localStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY);
    if (stored) {
      cachedAccessToken = stored;
      return stored;
    }
  } catch {}
  return null;
};

export interface LinkedProvidersInfo {
  isGoogleLinked: boolean;
  isGithubLinked: boolean;
  googleEmail?: string;
  githubEmail?: string;
  githubUsername?: string;
}

export const getLinkedProviders = (user: User | null): LinkedProvidersInfo => {
  if (!user || !user.providerData) {
    return { isGoogleLinked: false, isGithubLinked: false };
  }

  const googleData = user.providerData.find((p) => p.providerId === 'google.com');
  const githubData = user.providerData.find((p) => p.providerId === 'github.com');

  return {
    isGoogleLinked: Boolean(googleData),
    isGithubLinked: Boolean(githubData),
    googleEmail: googleData?.email || (user.email && user.email.includes('@gmail.com') ? user.email : undefined),
    githubEmail: githubData?.email || undefined,
    githubUsername: githubData?.displayName || undefined,
  };
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const token = getAccessToken();
      if (onAuthSuccess) onAuthSuccess(user, token);
    } else {
      setCachedAccessToken(null);
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Connect or sign in with Google.
 * Handles both new sign-ins and linking with an existing signed-in account (e.g. GitHub).
 * Gracefully resolves 'auth/account-exists-with-different-credential' and 'auth/credential-already-in-use'.
 */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    let resultUser: User;
    let token = '';

    const currentUser = auth.currentUser;

    if (currentUser) {
      // User is already signed in (e.g. via GitHub).
      // Attempt to link Google credentials so both providers are active.
      try {
        const linkResult = await linkWithPopup(currentUser, googleProvider);
        resultUser = linkResult.user;
        const cred = GoogleAuthProvider.credentialFromResult(linkResult);
        token = cred?.accessToken || '';
      } catch (linkError: any) {
        if (
          linkError?.code === 'auth/popup-closed-by-user' ||
          linkError?.code === 'auth/cancelled-popup-request'
        ) {
          return null;
        }

        // If the Google account is already registered as its own Firebase account or already linked:
        if (
          linkError?.code === 'auth/credential-already-in-use' ||
          linkError?.code === 'auth/account-exists-with-different-credential' ||
          linkError?.code === 'auth/provider-already-linked'
        ) {
          console.info('Google account already exists or linked, proceeding with sign-in:', linkError.code);
          const signInResult = await signInWithPopup(auth, googleProvider);
          resultUser = signInResult.user;
          const cred = GoogleAuthProvider.credentialFromResult(signInResult);
          token = cred?.accessToken || '';
        } else {
          throw linkError;
        }
      }
    } else {
      // No active session: standard Google sign-in
      try {
        const signInResult = await signInWithPopup(auth, googleProvider);
        resultUser = signInResult.user;
        const cred = GoogleAuthProvider.credentialFromResult(signInResult);
        token = cred?.accessToken || '';
      } catch (signInErr: any) {
        if (
          signInErr?.code === 'auth/popup-closed-by-user' ||
          signInErr?.code === 'auth/cancelled-popup-request'
        ) {
          return null;
        }

        // If account exists with GitHub, extract pending credential to save accessToken for APIs
        if (signInErr?.code === 'auth/account-exists-with-different-credential') {
          console.warn('Google sign-in encountered account-exists-with-different-credential');
          const pendingCred = GoogleAuthProvider.credentialFromError(signInErr);
          if (pendingCred?.accessToken) {
            token = pendingCred.accessToken;
            setCachedAccessToken(token);
          }
          throw new Error('Your email is already registered with GitHub. Sign in with GitHub first, then tap "Connect Google" to link both accounts.');
        }

        throw signInErr;
      }
    }

    if (token) {
      setCachedAccessToken(token);
    }

    return { user: resultUser, accessToken: token };
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }
    if (error?.code === 'auth/unauthorized-domain') {
      const currentDomain = typeof window !== 'undefined' ? window.location.hostname : 'your deployment domain';
      const friendlyMsg = `Firebase Auth: Domain "${currentDomain}" is not in the Authorized Domains list for project "${effectiveFirebaseConfig.projectId}". To fix: Open Firebase Console > Authentication > Settings > Authorized domains > Add "${currentDomain}".`;
      console.error(friendlyMsg);
      const customErr = new Error(friendlyMsg);
      (customErr as any).code = 'auth/unauthorized-domain';
      (customErr as any).domain = currentDomain;
      throw customErr;
    }
    console.error('Google sign-in error:', error);
    throw error;
  }
};

/**
 * Connect or sign in with GitHub.
 * Handles linking with current Google account or standard GitHub sign-in.
 */
export const githubSignIn = async (): Promise<{ user: User } | null> => {
  try {
    const currentUser = auth.currentUser;
    let resultUser: User;

    if (currentUser) {
      try {
        const linkResult = await linkWithPopup(currentUser, githubProvider);
        resultUser = linkResult.user;
      } catch (linkError: any) {
        if (
          linkError?.code === 'auth/popup-closed-by-user' ||
          linkError?.code === 'auth/cancelled-popup-request'
        ) {
          return null;
        }

        if (
          linkError?.code === 'auth/credential-already-in-use' ||
          linkError?.code === 'auth/account-exists-with-different-credential' ||
          linkError?.code === 'auth/provider-already-linked'
        ) {
          const signInResult = await signInWithPopup(auth, githubProvider);
          resultUser = signInResult.user;
        } else {
          throw linkError;
        }
      }
    } else {
      const signInResult = await signInWithPopup(auth, githubProvider);
      resultUser = signInResult.user;
    }

    return { user: resultUser };
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }
    console.error('GitHub sign-in error:', error);
    throw error;
  }
};

/**
 * Disconnect Google provider. If GitHub is also connected, unlinks Google so GitHub stays active.
 */
export const disconnectGoogle = async (): Promise<User | null> => {
  setCachedAccessToken(null);
  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  const isGoogleLinked = currentUser.providerData.some((p) => p.providerId === 'google.com');
  const isOtherLinked = currentUser.providerData.some((p) => p.providerId !== 'google.com');

  if (isGoogleLinked && isOtherLinked) {
    try {
      const updatedUser = await unlink(currentUser, 'google.com');
      return updatedUser;
    } catch (err) {
      console.warn('Failed to unlink Google, signing out:', err);
      await signOut(auth);
      return null;
    }
  } else {
    await signOut(auth);
    return null;
  }
};

/**
 * Disconnect GitHub provider. If Google is also connected, unlinks GitHub so Google stays active.
 */
export const disconnectGithub = async (): Promise<User | null> => {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  const isGithubLinked = currentUser.providerData.some((p) => p.providerId === 'github.com');
  const isOtherLinked = currentUser.providerData.some((p) => p.providerId !== 'github.com');

  if (isGithubLinked && isOtherLinked) {
    try {
      const updatedUser = await unlink(currentUser, 'github.com');
      return updatedUser;
    } catch (err) {
      console.warn('Failed to unlink GitHub, signing out:', err);
      await signOut(auth);
      return null;
    }
  } else {
    await signOut(auth);
    return null;
  }
};

export const logout = async () => {
  setCachedAccessToken(null);
  await signOut(auth);
};

