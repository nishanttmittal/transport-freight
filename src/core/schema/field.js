/**
 * Schema / Field Definitions (data-driven fields)
 * ------------------------------------------------
 * A module describes its record shape as a list of FIELD definitions instead
 * of hard-coding inputs and table columns. Forms, tables, defaults and
 * normalization are all generated from this one source of truth.
 *
 * To add a new field to a record (requirement: easy field addition):
 *   1. Add one `field({...})` entry to the module's schema array.
 *   2. (Optional) add a migration to backfill old records — but you usually
 *      don't need to, because `normalizeRecord` fills the default on read,
 *      so existing records that lack the field keep working untouched.
 *
 * Supported field types: text | number | select | date | toggle
 */

/**
 * Define a single field.
 * @param {object} def
 * @param {string}  def.name      record property key
 * @param {string}  def.label     human label for UI
 * @param {string}  def.type      one of the supported types
 * @param {*}       [def.default] value used when missing (default-on-read)
 * @param {boolean} [def.required]
 * @param {string[]|(()=>string[])} [def.options]  for `select`
 * @param {boolean} [def.inList]  show as a column in list/table views
 * @param {string}  [def.placeholder]
 */
export function field(def) {
  return {
    type: 'text',
    default: '',
    required: false,
    inList: true,
    ...def,
  }
}

/** Resolve a field's options whether given as array or factory function. */
export function fieldOptions(f) {
  return typeof f.options === 'function' ? f.options() : (f.options || [])
}

/**
 * Build an empty record from a schema, applying each field's default.
 * @param {object[]} schema
 */
export function emptyRecord(schema) {
  const r = {}
  for (const f of schema) {
    r[f.name] = typeof f.default === 'function' ? f.default() : f.default
  }
  return r
}

/**
 * Normalize a stored record against the current schema: any field missing
 * from an old record is filled with its default. This is the mechanism that
 * keeps the app from breaking when new fields are introduced.
 * @param {object[]} schema
 */
export function makeNormalizer(schema) {
  return (record) => {
    const out = { ...record }
    for (const f of schema) {
      if (out[f.name] === undefined) {
        out[f.name] = typeof f.default === 'function' ? f.default() : f.default
      }
    }
    return out
  }
}

/**
 * Validate a record against required fields.
 * @returns {string[]} list of human-readable errors (empty = valid)
 */
export function validateRecord(schema, record) {
  const errors = []
  for (const f of schema) {
    if (!f.required) continue
    const v = record[f.name]
    const missing = v === '' || v == null || (f.type === 'number' && !Number(v))
    if (missing) errors.push(`${f.label} is required`)
  }
  return errors
}
