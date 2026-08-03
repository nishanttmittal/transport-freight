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
function resolveAuthDomain() {
  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (h.endsWith('.web.app') || h.endsWith('.firebaseapp.com')) return h
  }
  return 'unico-operations.firebaseapp.com'
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
