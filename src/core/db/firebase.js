/**
 * Firebase service for the Transport Freight Hisab app. Shares the SAME project
 * (`unico-operations`) as the other UNICO apps, under its own namespace so a
 * future combined ERP dashboard can read every app uniformly:
 *   apps/transportfreight/transporters/{id}  ← gaadiwalas we pay
 *   apps/transportfreight/destinations/{id}   ← transport booking offices (dropdown)
 *   apps/transportfreight/entries/{id}        ← one drop to one destination
 *   apps/transportfreight/advances/{id}       ← money paid to a gaadiwala
 *   apps/transportfreight/settlements/{id}    ← finalized + locked hisab
 *   apps/transportfreight/users/{id}          ← role-based access
 *   apps/transportfreight/logs/{id}
 * Offline-capable (persistent cache) so staff can record without internet.
 */
import { initializeApp, getApp } from 'firebase/app'
import {
  initializeFirestore, collection, doc,
  persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore'
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup,
} from 'firebase/auth'
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig'

const APP_NS = 'transportfreight'

let app = null
let db = null
let auth = null

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalAutoDetectLongPolling: true,
  })
  auth = getAuth(app)
}

export { app, db, auth, isFirebaseConfigured, APP_NS }

const coll = (name) => collection(db, 'apps', APP_NS, name)
const cdoc = (name, id) => doc(db, 'apps', APP_NS, name, id)

export const paths = {
  transporters: () => coll('transporters'),
  transporter: (id) => cdoc('transporters', id),
  destinations: () => coll('destinations'),
  destination: (id) => cdoc('destinations', id),
  entries: () => coll('entries'),
  entry: (id) => cdoc('entries', id),
  advances: () => coll('advances'),
  advance: (id) => cdoc('advances', id),
  settlements: () => coll('settlements'),
  settlementDoc: (id) => cdoc('settlements', id),
  users: () => coll('users'),
  user: (id) => cdoc('users', id),
  logs: () => coll('logs'),
  logDoc: (id) => cdoc('logs', id),
  counters: () => cdoc('meta', 'counters'),
}

export function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    if (!auth) return reject(new Error('Firebase not configured'))
    const unsub = onAuthStateChanged(auth, (user) => { if (user) { unsub(); resolve(user.uid) } })
    signInAnonymously(auth).catch(reject)
  })
}

/**
 * Sign the MAIN session in with Google (Staff/Owner). This replaces the
 * anonymous session so Firestore rules can see request.auth.token.email and
 * enforce roles. On iPhone Safari, popups can be blocked — we fall back to a
 * full-page redirect automatically.
 */
export async function signInWithGoogle() {
  if (!auth) throw new Error('Cloud not configured')
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  // FIX 2026-07-19 (the 3-July→ outage): in an INSTALLED home-screen PWA (iOS/Android
  // standalone), signInWithPopup opens a window that can never message back — it neither
  // resolves nor rejects, so the button hung at "Opening…" forever and staff could not
  // log in at all. Standalone mode must go straight to the full-page redirect.
  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true)
  if (standalone) {
    const { signInWithRedirect } = await import('firebase/auth')
    return signInWithRedirect(auth, provider)
  }
  try {
    return await signInWithPopup(auth, provider)
  } catch (e) {
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/cancelled-popup-request' || e?.code === 'auth/operation-not-supported-in-this-environment') {
      const { signInWithRedirect } = await import('firebase/auth')
      return signInWithRedirect(auth, provider)
    }
    throw e
  }
}

/** Sign out the current user (returns to the Google sign-in screen). */
export function signOutUser() { return auth ? auth.signOut() : Promise.resolve() }

/** Subscribe to auth state. Calls cb(user|null); user.isAnonymous distinguishes anon. */
export function watchAuth(cb) {
  if (!auth) { cb(null); return () => {} }
  return onAuthStateChanged(auth, cb)
}

/** Google identity check for unlocking Admin (isolated secondary app). */
export async function verifyAdminGoogle() {
  if (!isFirebaseConfigured) throw new Error('Cloud not configured')
  const NAME = 'adminVerify'
  let secondary
  try { secondary = getApp(NAME) } catch { secondary = initializeApp(firebaseConfig, NAME) }
  const aAuth = getAuth(secondary)
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const cred = await signInWithPopup(aAuth, provider)
  const email = (cred.user.email || '').toLowerCase()
  await aAuth.signOut().catch(() => {})
  return email
}
