/**
 * Transport Freight Hisab — record schemas.
 *  • transporter = gaadiwala we pay (own running hisab)
 *  • destination = transport booking office (dropdown master, no re-typing)
 *  • entry       = ONE drop to ONE destination (its own freight + charges)
 *  • advance     = money paid to a gaadiwala (by Nishant/Anshul)
 *  • settlement  = a finalized, locked hisab period + snapshot
 *
 * Hidden (inList:false) backbone fields tag every record so a future combined
 * ERP dashboard can read this app's data with no schema redesign. The normalizer
 * backfills them onto old records on read, so nothing breaks when fields are added.
 */
import { field } from '../../core/schema/field'
import { todayStr } from '../../core/utils/format'

export const transporterSchema = [
  field({ name: 'name',           label: 'Gaadiwala', type: 'text',   default: '', required: true }),
  field({ name: 'phone',          label: 'Phone',       type: 'text',   default: '' }),
  field({ name: 'active',         label: 'Active',      type: 'toggle', default: true }),
  // running balance (maintained incrementally; full recompute available in Admin)
  field({ name: 'runningBalance', label: 'Balance',     type: 'number', default: 0, inList: false }),
  // highest threshold level already alerted (so a banner escalates, not repeats)
  field({ name: 'alertedLevel',   label: 'Alerted',     type: 'number', default: 0, inList: false }),
  field({ name: 'deleted',        label: 'Deleted',     type: 'toggle', default: false, inList: false }),
]

export const destinationSchema = [
  field({ name: 'name',    label: 'Transport (destination)', type: 'text',   default: '', required: true }),
  field({ name: 'active',  label: 'Active',                  type: 'toggle', default: true }),
  field({ name: 'deleted', label: 'Deleted',                 type: 'toggle', default: false, inList: false }),
]

export const entrySchema = [
  field({ name: 'date',          label: 'Date',        type: 'date',   default: todayStr, required: true }),
  field({ name: 'challanNo',     label: 'Challan No',  type: 'number', default: 0 }),
  field({ name: 'transporterId', label: 'Gaadiwala', type: 'text',   default: '', required: true }),
  field({ name: 'gaadiNumber',   label: 'Gaadi No',    type: 'text',   default: '' }),
  field({ name: 'destinationId', label: 'Transport',   type: 'text',   default: '', required: true }),
  field({ name: 'bags',          label: 'Bags',        type: 'number', default: 0 }),
  field({ name: 'pvtMarka',      label: 'Pvt Marka',   type: 'text',   default: '' }),
  field({ name: 'freight',       label: 'Freight',     type: 'number', default: 0 }),
  field({ name: 'lrCharge',      label: 'LR Charge',   type: 'number', default: 0 }),
  field({ name: 'unloading',     label: 'Unloading',   type: 'number', default: 0 }),
  field({ name: 'misc',          label: 'Misc',        type: 'number', default: 0 }),
  field({ name: 'extraPoint',    label: 'Extra Point', type: 'number', default: 0 }),
  field({ name: 'remarks',       label: 'Remarks',     type: 'text',   default: '' }),
  field({ name: 'deleted',       label: 'Deleted',     type: 'toggle', default: false, inList: false }),
  // backbone / audit (hidden)
  field({ name: 'batchId',       label: 'Batch ID',        default: '', inList: false }),
  field({ name: 'sourceApp',     label: 'Source App',      default: 'transportfreight', inList: false }),
  field({ name: 'workflowStage', label: 'Workflow Stage',  default: 'transport', inList: false }),
  field({ name: 'createdByRole', label: 'Created By Role', default: '', inList: false }),
  field({ name: 'createdByUser', label: 'Created By',      default: '', inList: false }),
  field({ name: 'factoryId',     label: 'Factory ID',      default: 'main', inList: false }),
]

export const advanceSchema = [
  field({ name: 'date',          label: 'Date',        type: 'date',   default: todayStr, required: true }),
  field({ name: 'transporterId', label: 'Gaadiwala', type: 'text',   default: '', required: true }),
  field({ name: 'amount',        label: 'Amount',      type: 'number', default: 0 }),
  field({ name: 'paidBy',        label: 'Paid By',     type: 'text',   default: 'Nishant' }), // Nishant | Anshul
  field({ name: 'note',          label: 'Note',        type: 'text',   default: '' }),
  field({ name: 'reversed',      label: 'Reversed',    type: 'toggle', default: false }),
  field({ name: 'deleted',       label: 'Deleted',     type: 'toggle', default: false, inList: false }),
  field({ name: 'createdByUser', label: 'Created By',  default: '', inList: false }),
]

export const settlementSchema = [
  field({ name: 'transporterId', label: 'Gaadiwala', type: 'text',   default: '', required: true }),
  field({ name: 'periodFrom',    label: 'From',        type: 'text',   default: '' }),
  field({ name: 'periodTo',      label: 'To',          type: 'text',   default: '' }),   // cutoff (lock on/before)
  field({ name: 'totalFreight',  label: 'Freight',     type: 'number', default: 0 }),
  field({ name: 'totalAdvances', label: 'Advances',    type: 'number', default: 0 }),
  field({ name: 'balance',       label: 'Balance',     type: 'number', default: 0 }),
  field({ name: 'finalizedBy',   label: 'By',          type: 'text',   default: '' }),
  field({ name: 'locked',        label: 'Locked',      type: 'toggle', default: true }),
]

/** App user for role-based access (Google sign-in). Doc id = lowercased email. */
export const userSchema = [
  field({ name: 'email',  label: 'Email',  type: 'text',   default: '', required: true }),
  field({ name: 'name',   label: 'Name',   type: 'text',   default: '' }),
  field({ name: 'role',   label: 'Role',   type: 'text',   default: 'manager' }), // owner | manager
  field({ name: 'active', label: 'Active', type: 'toggle', default: true }),
]
