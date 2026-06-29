/**
 * Migration Runner (version-safe schema evolution)
 * --------------------------------------------------
 * Stored data carries a schema version. On every app boot we compare the
 * stored version to the current code version and run any migrations in
 * between, in order. This lets the data shape evolve over releases WITHOUT
 * losing or corrupting a user's existing data.
 *
 * How to add a migration when you change the data shape:
 *   1. Bump CURRENT_VERSION below by 1.
 *   2. Add a function to the `migrations` array at the new index.
 *      Each migration receives the storage API and mutates stored data.
 */

import { storage } from './storage'

const VERSION_KEY = '__schema_version'

/** The version the current code expects. MUST equal `migrations.length`. */
export const CURRENT_VERSION = 1

/**
 * Ordered migration steps. Index N upgrades data FROM version N TO N+1.
 * Keep every historical migration here forever — never edit old ones.
 * @type {Array<(api: typeof storage) => void>}
 */
const migrations = [
  // v0 -> v1 : baseline. Fresh install — collections are seeded lazily by
  // their repositories, so there is nothing to migrate yet.
  () => {},
]

/**
 * Run all pending migrations. Call once at app startup, before rendering.
 * @returns {{from:number,to:number,ran:number}} summary for logging
 */
export function runMigrations() {
  const from = storage.get(VERSION_KEY) ?? 0
  let ran = 0
  for (let v = from; v < CURRENT_VERSION; v++) {
    const step = migrations[v]
    if (typeof step === 'function') {
      step(storage)
      ran++
    }
  }
  if (from !== CURRENT_VERSION) storage.set(VERSION_KEY, CURRENT_VERSION)
  return { from, to: CURRENT_VERSION, ran }
}
