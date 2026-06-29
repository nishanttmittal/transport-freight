/**
 * useCollection — React binding for a Repository
 * ------------------------------------------------
 * Gives a component reactive state over a repository collection. Mutations go
 * through the repository (which persists), then refresh local state so the UI
 * re-renders. Components never touch storage directly.
 *
 *   const entries = useCollection(entriesRepo)
 *   entries.list                       // current records
 *   entries.insert(rec)                // persist + refresh
 *   entries.update(id, patch)
 *   entries.remove(id)
 *   entries.replaceAll(list)           // for restore/import
 */

import { useState, useCallback } from 'react'

export function useCollection(repo) {
  const [list, setList] = useState(() => repo.all())

  const refresh = useCallback(() => setList(repo.all()), [repo])

  return {
    list,
    refresh,
    insert: useCallback((rec) => { const row = repo.insert(rec); refresh(); return row }, [repo, refresh]),
    update: useCallback((id, patch) => { repo.update(id, patch); refresh() }, [repo, refresh]),
    remove: useCallback((id) => { repo.remove(id); refresh() }, [repo, refresh]),
    removeWhere: useCallback((pred) => { const n = repo.removeWhere(pred); refresh(); return n }, [repo, refresh]),
    replaceAll: useCallback((l) => { repo.replaceAll(l); refresh() }, [repo, refresh]),
    reset: useCallback(() => { repo.reset(); refresh() }, [repo, refresh]),
  }
}

/**
 * useSingleton — React binding for a singleton store (settings, simple lists).
 *   const [parties, setParties] = useSingleton(partiesStore)
 */
export function useSingleton(store) {
  const [value, setValue] = useState(() => store.get())
  const set = useCallback((v) => { store.set(v); setValue(v) }, [store])
  return [value, set]
}
