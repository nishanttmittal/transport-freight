/**
 * Repository (generic, reusable data-access layer)
 * -------------------------------------------------
 * A Repository wraps ONE persisted collection (an array of records stored under
 * one key) and gives it a clean CRUD API. Modules create one repository per
 * collection instead of reading/writing storage by hand. Swapping the storage
 * backend (localStorage -> cloud) requires zero changes here, because the
 * repository talks to the storage adapter, not to localStorage.
 *
 * Records are plain objects. A `createCollection` repository auto-assigns ids;
 * a `createSingleton` repository stores one value (e.g. a settings object or a
 * simple list of strings).
 */

import { storage } from './storage'

/** Generate a unique, sortable-ish id. */
let _seq = 0
export function makeId(prefix = 'r') {
  _seq += 1
  return `${prefix}_${Date.now().toString(36)}_${_seq}`
}

/**
 * A collection of records (array of objects), each with a unique `id`.
 *
 * @param {string} key             storage key for this collection
 * @param {object} [opts]
 * @param {() => object[]} [opts.seed]  default records for a fresh install
 * @param {(record:object)=>object} [opts.normalize]  applied on read to every
 *        record — the place to fill defaults for newly-added fields so old
 *        records keep working (see requirement: easy field addition).
 */
export function createCollection(key, opts = {}) {
  const { seed, normalize } = opts

  const read = () => {
    let list = storage.get(key)
    if (list == null) {
      list = typeof seed === 'function' ? seed() : []
      storage.set(key, list)
    }
    return normalize ? list.map(normalize) : list
  }

  const write = (list) => storage.set(key, list)

  return {
    /** Return all records (normalized). */
    all: read,

    /** Find one record by id, or null. */
    get(id) {
      return read().find(r => r.id === id) ?? null
    },

    /** Return records matching a predicate. */
    where(predicate) {
      return read().filter(predicate)
    },

    /** Insert a new record; auto-assigns `id`, `createdAt` and `updatedAt` if absent. */
    insert(record) {
      const list = read()
      const now = new Date().toISOString()
      const row = {
        id: record.id ?? makeId(),
        createdAt: record.createdAt ?? now,
        updatedAt: record.updatedAt ?? now,
        ...record,
      }
      write([...list, row])
      return row
    },

    /** Patch an existing record by id with a partial object (auto-stamps updatedAt). */
    update(id, patch) {
      const now = new Date().toISOString()
      write(read().map(r => (r.id === id ? { ...r, ...patch, updatedAt: now } : r)))
    },

    /** Delete one record by id. */
    remove(id) {
      write(read().filter(r => r.id !== id))
    },

    /** Delete all records matching a predicate; returns count removed. */
    removeWhere(predicate) {
      const list = read()
      const kept = list.filter(r => !predicate(r))
      write(kept)
      return list.length - kept.length
    },

    /** Replace the entire collection (used by restore/import). */
    replaceAll(list) {
      write(Array.isArray(list) ? list : [])
    },

    /** Wipe the collection back to its seed. */
    reset() {
      storage.remove(key)
    },
  }
}

/**
 * A single stored value (object or array), not a collection of records.
 * Useful for app settings or simple lists.
 *
 * @param {string} key
 * @param {*} defaultValue  value returned when nothing is stored yet
 */
export function createSingleton(key, defaultValue) {
  return {
    get() {
      const v = storage.get(key)
      return v == null ? defaultValue : v
    },
    set(value) {
      storage.set(key, value)
    },
    reset() {
      storage.remove(key)
    },
  }
}
