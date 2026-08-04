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
 * It is also the biggest LOAD-TIME factor (measured 2026-08-04): from github.io the
 * hidden /__/auth/iframe is cross-origin and cost 1,220 ms on a cold open; the
 * identical fetch same-origin took 37 ms.
 */
const PROJECT_AUTH_DOMAIN = 'unico-operations.firebaseapp.com'

/**
 * EXACT hosts whose own /__/auth/handler is registered with the Google OAuth client.
 * Matching is exact — NOT by suffix.
 *
 * ⚠️ Why not `*.web.app` / `*.firebaseapp.com`: a suffix test trusts ANY Firebase
 * site, including ones whose redirect URI was never registered. `unico-plating.web.app`
 * and `unico-welder.web.app` both exist and both FAIL Google sign-in with
 * redirect_uri_mismatch (July 2026). Trusting them by suffix would hand the auth
 * handler to a domain that cannot complete a login. Only `firebaseapp.com` — the
 * project default — is pre-registered; `.web.app` and custom domains are not.
 *
 * ⚠️ A host belongs here ONLY after BOTH registrations are done:
 *   1. Firebase console → Auth → Settings → Authorized domains → add it, AND
 *   2. Google Cloud console → APIs & Services → Credentials → OAuth 2.0 client
 *      "Web client (auto created by Google Service)" → add redirect URI
 *      https://<host>/__/auth/handler  + JS origin  https://<host>
 * The host must also actually SERVE Firebase Hosting's reserved /__/auth/* paths
 * (a Hosting custom domain — not a proxy/CDN in front of one). Verify with a REAL
 * sign-in before adding: reaching Google's account chooser = registered;
 * accounts.google.com/.../oauth/error?...redirect_uri_mismatch = not.
 */
export const APPROVED_AUTH_HOSTS = new Set([
  'unico-operations.firebaseapp.com',
  // 'freight.unicoproductsindia.com',   // only after steps 1 + 2 above
])

/**
 * Pure, environment-independent so it can be unit-tested (see authDomain.test.mjs).
 * Normalises the way a browser would: lowercase, trimmed, trailing FQDN dot removed.
 * Anything not explicitly approved falls back to the project default — cross-origin
 * (slower, and popup-only on iOS) but always able to complete a login. Fail closed.
 */
export function pickAuthDomain(hostname, approved = APPROVED_AUTH_HOSTS) {
  const h = String(hostname ?? '').trim().toLowerCase().replace(/\.$/, '')
  return approved.has(h) ? h : PROJECT_AUTH_DOMAIN
}

function resolveAuthDomain() {
  if (typeof window === 'undefined') return PROJECT_AUTH_DOMAIN
  return pickAuthDomain(window.location.hostname)
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
