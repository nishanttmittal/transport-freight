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

export const firebaseConfig = {
  apiKey:            'AIzaSyCK0M-EfmOp9nh1-ZJcrBqT7c4plNxL2FM',
  authDomain:        'unico-operations.firebaseapp.com',
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
