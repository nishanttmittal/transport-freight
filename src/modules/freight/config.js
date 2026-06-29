/** Transport Freight Hisab — configuration & constants. */
export const APP_TITLE = 'Transport Freight Hisab'

export const SOURCE_APP = 'transportfreight'
export const WORKFLOW_STAGE = 'transport'
export const DEFAULT_FACTORY_ID = 'main'

/** Bootstrap owner(s) — always owner, mirror in firestore.rules. Lowercase. */
export const OWNER_EMAILS = ['nspenterprises24@gmail.com']
export const ROLES = { owner: 'owner', manager: 'manager' }

/** Display name for the staff/manager role (office staff who enter freight). */
export const INCHARGE_LABEL = 'Staff'

/** Casual-delete speed-bump (page already owner-only via Google). Not security. */
export const ADMIN_PASSWORD = '6133923_N'

/** Correct an entry within this many hours; after that owner-only. */
export const EDIT_WINDOW_HOURS = 48

/** Who paid an advance. */
export const PAID_BY = ['Nishant', 'Anshul']

/** Hisab alert levels (₹). Banner escalates as a transporter's balance crosses each. */
export const THRESHOLD_LEVELS = [5000, 10000, 15000, 20000]

/** Free-typed extra-point hint shown on the entry form. */
export const EXTRA_POINT_HINT = '+50 same area · +200 far area (per extra drop)'

/** Quick-add chips on the bags stepper. */
export const QUICK_BAGS = [1, 2, 5, 10, 20, 50]

export const KEYS = {
  transporters: 'transporters',
  destinations: 'destinations',
  entries:      'entries',
  advances:     'advances',
  settlements:  'settlements',
  users:        'users',
  logs:         'logs',
  lastUsed:     'last_used',
}

/** Seed master lists for a fresh install (editable in Masters). */
export const DEFAULT_TRANSPORTERS = []
export const DEFAULT_DESTINATIONS = []
