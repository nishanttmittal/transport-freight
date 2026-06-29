/** Module registry — the transport-freight app's single module. */
import { freightModule } from './freight/manifest'

export const modules = [freightModule]
export const getModule = (id) => modules.find(m => m.id === id) || modules[0]
