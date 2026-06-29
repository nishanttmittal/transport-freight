/** Transport Freight — data access. Masters seed empty; entries accumulate. */
import { createCollection, createSingleton } from '../../core/db/repository'
import { makeNormalizer } from '../../core/schema/field'
import { transporterSchema, destinationSchema, entrySchema, advanceSchema, settlementSchema, userSchema } from './schema'
import { KEYS } from './config'

export const transportersRepo = createCollection(KEYS.transporters, { seed: () => [], normalize: makeNormalizer(transporterSchema) })
export const destinationsRepo = createCollection(KEYS.destinations, { seed: () => [], normalize: makeNormalizer(destinationSchema) })
export const entriesRepo      = createCollection(KEYS.entries,      { seed: () => [], normalize: makeNormalizer(entrySchema) })
export const advancesRepo     = createCollection(KEYS.advances,     { seed: () => [], normalize: makeNormalizer(advanceSchema) })
export const settlementsRepo  = createCollection(KEYS.settlements,  { seed: () => [], normalize: makeNormalizer(settlementSchema) })
export const usersRepo        = createCollection(KEYS.users,        { seed: () => [], normalize: makeNormalizer(userSchema) })
export const logsRepo         = createCollection(KEYS.logs,         { seed: () => [] })
export const lastUsedStore    = createSingleton(KEYS.lastUsed, {})
