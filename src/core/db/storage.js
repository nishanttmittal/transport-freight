/**
 * Storage Adapter — the single low-level gateway to persistent storage. The
 * active adapter is swappable (localStorage ↔ cloud) and all keys are namespaced
 * so this app never collides with others on the same domain.
 */

const APP_PREFIX = 'tf:' // transport-freight app namespace

const localStorageAdapter = {
  getRaw(key) {
    try {
      const raw = localStorage.getItem(APP_PREFIX + key)
      return raw == null ? null : JSON.parse(raw)
    } catch {
      return null
    }
  },
  setRaw(key, value) { localStorage.setItem(APP_PREFIX + key, JSON.stringify(value)) },
  remove(key) { localStorage.removeItem(APP_PREFIX + key) },
  keys() {
    return Object.keys(localStorage).filter(k => k.startsWith(APP_PREFIX)).map(k => k.slice(APP_PREFIX.length))
  },
}

let activeAdapter = localStorageAdapter
export function setStorageAdapter(adapter) { activeAdapter = adapter }

export const storage = {
  get: (key) => activeAdapter.getRaw(key),
  set: (key, value) => activeAdapter.setRaw(key, value),
  remove: (key) => activeAdapter.remove(key),
  keys: () => activeAdapter.keys(),
}
