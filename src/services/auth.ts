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
googleProvider.addScope('https://www.googleapis.com/auth/gmail.readonly');
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Multi-account Google OAuth storage
export interface ConnectedGoogleAccount {
  id: string; // unique email
  email: string;
  name: string;
  photoURL?: string;
  accessToken: string;
  connectedAt: number;
  isTokenExpired?: boolean;
}

const MULTI_GOOGLE_ACCOUNTS_KEY = 'kairo_connected_google_accounts';

export const getConnectedGoogleAccounts = (): ConnectedGoogleAccount[] => {
  try {
    const raw = localStorage.getItem(MULTI_GOOGLE_ACCOUNTS_KEY);
    if (!raw) return [];
    const accounts = JSON.parse(raw);
    return Array.isArray(accounts) ? accounts : [];
  } catch {
    return [];
  }
};

export const saveConnectedGoogleAccount = (acc: ConnectedGoogleAccount) => {
  try {
    const accounts = getConnectedGoogleAccounts();
    const existingIndex = accounts.findIndex((a) => a.email.toLowerCase() === acc.email.toLowerCase());
    if (existingIndex >= 0) {
      accounts[existingIndex] = { ...accounts[existingIndex], ...acc, isTokenExpired: false };
    } else {
      accounts.push(acc);
    }
    localStorage.setItem(MULTI_GOOGLE_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch (err) {
    console.warn('Failed to save connected Google account:', err);
  }
};

export const removeConnectedGoogleAccount = (email: string) => {
  try {
    const accounts = getConnectedGoogleAccounts();
    const filtered = accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
    localStorage.setItem(MULTI_GOOGLE_ACCOUNTS_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.warn('Failed to remove connected Google account:', err);
  }
};

export const markAccountTokenExpired = (email: string, expired: boolean) => {
  try {
    const accounts = getConnectedGoogleAccounts();
    const target = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (target) {
      target.isTokenExpired = expired;
      localStorage.setItem(MULTI_GOOGLE_ACCOUNTS_KEY, JSON.stringify(accounts));
    }
  } catch {}
};

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


const GITHUB_IDENTITY_KEY = 'kairo_github_identity';

export interface CachedGithubIdentity {
  email?: string;
  username?: string;
  displayName?: string;
  uid?: string;
}

export const saveCachedGithubIdentity = (info: CachedGithubIdentity | null) => {
  try {
    if (info) {
      localStorage.setItem(GITHUB_IDENTITY_KEY, JSON.stringify(info));
    } else {
      localStorage.removeItem(GITHUB_IDENTITY_KEY);
    }
  } catch {}
};

export const getCachedGithubIdentity = (): CachedGithubIdentity | null => {
  try {
    const raw = localStorage.getItem(GITHUB_IDENTITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export interface LinkedProvidersInfo {
  isGoogleLinked: boolean;
  isGithubLinked: boolean;
  googleEmail?: string;
  githubEmail?: string;
  githubUsername?: string;
}

export const getLinkedProviders = (user: User | null): LinkedProvidersInfo => {
  const cachedGithub = getCachedGithubIdentity();
  const cachedGoogleToken = getAccessToken();

  if (!user && !cachedGithub && !cachedGoogleToken) {
    return { isGoogleLinked: false, isGithubLinked: false };
  }

  const googleData = user?.providerData?.find((p) => p.providerId === 'google.com');
  const githubData = user?.providerData?.find((p) => p.providerId === 'github.com');

  const isGoogleLinked = Boolean(googleData || cachedGoogleToken);
  const isGithubLinked = Boolean(githubData || cachedGithub);

  return {
    isGoogleLinked,
    isGithubLinked,
    googleEmail: googleData?.email || (user?.email && user.email.includes('@') ? user.email : undefined),
    githubEmail: githubData?.email || cachedGithub?.email || undefined,
    githubUsername: githubData?.displayName || cachedGithub?.username || cachedGithub?.displayName || undefined,
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
      const cachedGh = getCachedGithubIdentity();
      const cachedToken = getAccessToken();
      if (!cachedGh && !cachedToken) {
        setCachedAccessToken(null);
        if (onAuthFailure) onAuthFailure();
      }
    }
  });
};

/**
 * Connect or sign in with Google.
 * Handles both new sign-ins and linking with an existing signed-in account (e.g. GitHub).
 * Seamlessly resolves 'auth/credential-already-in-use' without triggering the browser popup blocker.
 */
export const googleSignIn = async (options?: { forceDirectSignIn?: boolean }): Promise<{ user: User; accessToken: string } | null> => {
  try {
    let resultUser: User;
    let token = '';

    const currentUser = auth.currentUser;

    // If currentUser is signed in with GitHub:
    // Store their GitHub identity first so it persists even if Firebase switches users
    if (currentUser) {
      const gh = currentUser.providerData?.find((p) => p.providerId === 'github.com');
      saveCachedGithubIdentity({
        email: gh?.email || currentUser.email || undefined,
        displayName: gh?.displayName || currentUser.displayName || undefined,
        username: gh?.displayName || currentUser.displayName || undefined,
        uid: currentUser.uid,
      });
    }

    if (currentUser && !options?.forceDirectSignIn) {
      // Attempt linking first to keep one unified Firebase UID if possible
      try {
        const linkResult = await linkWithPopup(currentUser, googleProvider);
        resultUser = linkResult.user;
        const cred = GoogleAuthProvider.credentialFromResult(linkResult);
        token =
          cred?.accessToken ||
          (linkResult as any)?._tokenResponse?.oauthAccessToken ||
          (linkResult as any)?._tokenResponse?.accessToken ||
          (linkResult as any)?.credential?.accessToken ||
          '';
      } catch (linkError: any) {
        if (
          linkError?.code === 'auth/popup-closed-by-user' ||
          linkError?.code === 'auth/cancelled-popup-request'
        ) {
          return null;
        }

        // When the Google credential is already used by a separate Firebase account:
        // DO NOT immediately call signInWithPopup inside this catch block because modern browsers
        // classify the subsequent popup as untrusted and trigger 'auth/popup-blocked'.
        // Instead, throw a structured conflict error that the UI can catch to offer a 1-tap direct sign-in!
        if (
          linkError?.code === 'auth/credential-already-in-use' ||
          linkError?.code === 'auth/account-exists-with-different-credential' ||
          linkError?.code === 'auth/provider-already-linked'
        ) {
          const err = new Error('Your Google account is already registered separately. Tap "Sign In with Google" to connect Calendar & Classroom.');
          (err as any).code = 'auth/credential-already-in-use';
          (err as any).isAccountConflict = true;
          throw err;
        } else {
          throw linkError;
        }
      }
    } else {
      // Standard or direct Google sign-in (1 single popup gesture, never blocked!)
      const signInResult = await signInWithPopup(auth, googleProvider);
      resultUser = signInResult.user;
      const cred = GoogleAuthProvider.credentialFromResult(signInResult);
      token =
        cred?.accessToken ||
        (signInResult as any)?._tokenResponse?.oauthAccessToken ||
        (signInResult as any)?._tokenResponse?.accessToken ||
        (signInResult as any)?.credential?.accessToken ||
        '';
    }

    if (token) {
      setCachedAccessToken(token);
    }

    if (resultUser && resultUser.email) {
      saveConnectedGoogleAccount({
        id: resultUser.email,
        email: resultUser.email,
        name: resultUser.displayName || resultUser.email.split('@')[0],
        photoURL: resultUser.photoURL || undefined,
        accessToken: token,
        connectedAt: Date.now(),
        isTokenExpired: false,
      });
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
 * Connect an additional Google / Gmail account independently.
 * Prompts Google account chooser and stores account under `kairo_connected_google_accounts`.
 */
export const connectAdditionalGoogleAccount = async (): Promise<ConnectedGoogleAccount | null> => {
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/calendar.events.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
    provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
    provider.setCustomParameters({
      prompt: 'select_account',
    });

    const result = await signInWithPopup(auth, provider);
    const cred = GoogleAuthProvider.credentialFromResult(result);
    const token =
      cred?.accessToken ||
      (result as any)?._tokenResponse?.oauthAccessToken ||
      (result as any)?._tokenResponse?.accessToken ||
      '';

    if (result.user && result.user.email) {
      const acc: ConnectedGoogleAccount = {
        id: result.user.email,
        email: result.user.email,
        name: result.user.displayName || result.user.email.split('@')[0],
        photoURL: result.user.photoURL || undefined,
        accessToken: token,
        connectedAt: Date.now(),
        isTokenExpired: false,
      };
      saveConnectedGoogleAccount(acc);
      if (token) {
        setCachedAccessToken(token);
      }
      return acc;
    }
    return null;
  } catch (err: any) {
    if (
      err?.code === 'auth/popup-closed-by-user' ||
      err?.code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }
    console.error('Failed to connect additional Google account:', err);
    throw err;
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

    // Cache existing Google token if present so Calendar remains active
    const googleToken = getAccessToken();

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

    if (resultUser) {
      const gh = resultUser.providerData?.find((p) => p.providerId === 'github.com');
      saveCachedGithubIdentity({
        email: gh?.email || resultUser.email || undefined,
        displayName: gh?.displayName || resultUser.displayName || undefined,
        username: gh?.displayName || resultUser.displayName || undefined,
        uid: resultUser.uid,
      });
    }

    if (googleToken) {
      setCachedAccessToken(googleToken);
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
    } catch {
      return currentUser;
    }
  }
  return currentUser;
};

/**
 * Disconnect GitHub provider. If Google is also connected, unlinks GitHub so Google stays active.
 */
export const disconnectGithub = async (): Promise<User | null> => {
  saveCachedGithubIdentity(null);
  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  const isGithubLinked = currentUser.providerData.some((p) => p.providerId === 'github.com');
  const isOtherLinked = currentUser.providerData.some((p) => p.providerId !== 'github.com');

  if (isGithubLinked && isOtherLinked) {
    try {
      const updatedUser = await unlink(currentUser, 'github.com');
      return updatedUser;
    } catch {
      return currentUser;
    }
  }
  return currentUser;
};

export const logout = async () => {
  setCachedAccessToken(null);
  saveCachedGithubIdentity(null);
  await signOut(auth);
};

