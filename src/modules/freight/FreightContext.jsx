/**
 * FreightContext — module state (transporters, destinations, entries, advances,
 * settlements, users, logs). Two backends with the same shape: LocalFreightProvider
 * (localStorage) and FirestoreProvider (cloud, real-time, offline). FreightProvider
 * picks cloud when configured.
 */
import { createContext, useContext, useCallback } from 'react'
import { useCollection } from '../../core/hooks/useCollection'
import { transportersRepo, destinationsRepo, entriesRepo, advancesRepo, settlementsRepo, usersRepo, logsRepo, lastUsedStore } from './data'
import { isFirebaseConfigured } from '../../core/db/firebaseConfig'
import { FirestoreProvider } from './FirestoreProvider'
import { nextFromCounters, COUNTER_START } from './logic/counters'

const Ctx = createContext(null)
export { Ctx as FreightCtx }

export function FreightProvider({ children }) {
  return isFirebaseConfigured
    ? <FirestoreProvider>{children}</FirestoreProvider>
    : <LocalFreightProvider>{children}</LocalFreightProvider>
}

export function LocalFreightProvider({ children }) {
  const transporters = useCollection(transportersRepo)
  const destinations = useCollection(destinationsRepo)
  const entries      = useCollection(entriesRepo)
  const advances     = useCollection(advancesRepo)
  const settlements  = useCollection(settlementsRepo)
  const users        = useCollection(usersRepo)
  const logs         = useCollection(logsRepo)

  const log = useCallback((action, detail, by = 'user', ref = '') => {
    logs.insert({ ts: new Date().toISOString(), action, detail, by, ref })
  }, [logs])

  // Offline mode has no transactions — allocate from a lastUsed-backed counter.
  const allocateNumber = useCallback(async (kind) => {
    const c = lastUsedStore.get() || {}
    const n = nextFromCounters(c.counters || {}, kind, COUNTER_START[kind])
    lastUsedStore.set({ ...c, counters: { ...(c.counters || {}), [kind]: n } })
    return n
  }, [])

  // Offline mode has no transactions — write sequentially (best-effort parity).
  const settleBatch = useCallback(async ({ payment = null, settlement, transporterId, transporterPatch }) => {
    let paymentId = null
    if (payment) { const r = advances.insert(payment); paymentId = r.id }
    const s = settlements.insert(settlement)
    transporters.update(transporterId, transporterPatch)
    return { paymentId, settlementId: s.id }
  }, [advances, settlements, transporters])

  const value = {
    transporters, destinations,
    entries: { ...entries, updateGuarded: async (id, _rev, patch) => { entries.update(id, patch); return { ok: true } } },
    advances, settlements, users, logs,
    lastUsed: lastUsedStore, log, allocateNumber, settleBatch,
    cloud: { connected: false, error: '' },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFreight() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFreight must be used inside <FreightProvider>')
  return v
}
