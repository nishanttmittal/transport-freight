/**
 * Device-local outbox — the phone-first buffer. A chakkar/advance is written here
 * the instant Save is tapped (before any network), then uploaded when possible.
 * Persisted via the shared, swappable `storage` adapter (localStorage in the app,
 * an in-memory adapter in tests). Items carry deterministic ids so an upload retry
 * overwrites its own docs instead of duplicating.
 */
import { storage } from '../../../core/db/storage.js'

const KEY = 'outbox'

export function outboxList() { return storage.get(KEY) || [] }

export function outboxEnqueue(item) {
  const list = outboxList()
  if (list.some(x => x.id === item.id)) return list
  const next = [...list, item]
  storage.set(KEY, next)
  return next
}

export function outboxUpdate(item) {
  const next = outboxList().map(x => (x.id === item.id ? item : x))
  storage.set(KEY, next)
  return next
}

export function outboxRemove(id) {
  const next = outboxList().filter(x => x.id !== id)
  storage.set(KEY, next)
  return next
}

export function outboxHas(id) { return outboxList().some(x => x.id === id) }
export function outboxClear() { storage.set(KEY, []) }

/**
 * Pending CHAKKAR rows, flattened + tagged, so the dup-check and list views can
 * see chakkars saved on the phone but not yet uploaded (otherwise a worker who
 * distrusts the banner could re-enter one → two real chakkars → doubled payable).
 * Advances are excluded (no entry rows).
 */
export function outboxEntryRows() {
  return outboxList()
    .filter(x => (x.kind === 'new' || x.kind === 'pending') && Array.isArray(x.inserts))
    .flatMap(x => x.inserts.map(r => ({ ...r, pendingUpload: true })))
}
