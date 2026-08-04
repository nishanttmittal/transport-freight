/**
 * Firebase configuration (project: unico-operations — shared with other apps).
 * ──────────────────────────────────────────────────────────────────────────
 * These values are NOT secret — Firebase web config is meant to ship in the
 * client. Security comes from Firestore Rules (see firestore.rules), not from
 * hiding these.
 *
 * Offline override: open the app with `?local=1` in the URL to force pure
 * on-device (localStorage) mode with no cloud — handy for a quick offline demo
 * or if the cloud is unreachable. Data entered in local mode stays on that
 * device only.
 */

/**
 * Google sign-in must be SAME-ORIGIN as the app, or installed iPhone PWAs can't
 * complete it (iOS blocks reading the auth session across origins → login loops).
 * When served from a Firebase Hosting domain (*.web.app / *.firebaseapp.com) use
 * THAT hostname as the authDomain (its auth handler is first-party); elsewhere
 * (github.io fallback) keep the project default, where Safari's popup still works.
 *
 * This is also the app's biggest LOAD-TIME win (measured 2026-08-04): from
 * github.io the hidden /__/auth/iframe is cross-origin and cost 1,220 ms on a
 * cold open; same-origin on firebaseapp.com the identical fetch took 77 ms.
 */
const PROJECT_AUTH_DOMAIN = 'unico-operations.firebaseapp.com'

/**
 * Custom domains that are SAFE to use as their own authDomain.
 *
 * ⚠️ A domain belongs here ONLY after BOTH registrations are done, or Google
 * answers `redirect_uri_mismatch` and NOBODY can log in:
 *   1. Firebase console → Auth → Settings → Authorized domains → add it, AND
 *   2. Google Cloud console → APIs & Services → Credentials → OAuth 2.0 client
 *      "Web client (auto created by Google Service)" → add redirect URI
 *      https://<domain>/__/auth/handler  + JS origin  https://<domain>
 * The domain must also actually SERVE Firebase Hosting's reserved /__/auth/*
 * paths — i.e. it is a Hosting custom domain, not a proxy/CDN in front of one.
 *
 * Empty today, so behaviour is unchanged. Adding a custom domain is then a
 * deliberate one-line edit — never a silent fallback.
 */
const SAME_ORIGIN_AUTH_HOSTS = [
  // 'freight.unicoproductsindia.com',
]

function resolveAuthDomain() {
  if (typeof window === 'undefined') return PROJECT_AUTH_DOMAIN
  // Explicit build-time override always wins (VITE_AUTH_DOMAIN=…).
  const forced = import.meta.env?.VITE_AUTH_DOMAIN
  if (forced) return forced
  const h = window.location.hostname
  // Firebase Hosting's own domains always serve /__/auth/* and are pre-registered.
  if (h.endsWith('.web.app') || h.endsWith('.firebaseapp.com')) return h
  // A registered custom domain (see the list above).
  if (SAME_ORIGIN_AUTH_HOSTS.includes(h)) return h
  // Anything else (github.io fallback, localhost) → project default, cross-origin
  // but working via Safari's popup path.
  return PROJECT_AUTH_DOMAIN
}

export const firebaseConfig = {
  apiKey:            'AIzaSyCK0M-EfmOp9nh1-ZJcrBqT7c4plNxL2FM',
  authDomain:        resolveAuthDomain(),
  projectId:         'unico-operations',
  storageBucket:     'unico-operations.firebasestorage.app',
  messagingSenderId: '367786260524',
  appId:             '1:367786260524:web:ae49d5da0ef1a71a9e3989',
}

const forceLocal =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('local') === '1'

/** True when real config is present AND offline override is not requested. */
export const isFirebaseConfigured =
  !forceLocal && !Object.values(firebaseConfig).some(v => typeof v === 'string' && v.startsWith('PASTE_'))
