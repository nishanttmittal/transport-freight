/**
 * ThresholdBanner — escalating in-app alert listing transporters whose pending
 * balance has crossed a ₹5k/10k/15k/20k level, worst first. NEVER blocks entry.
 * Isolated so a later phase can also push these to the WhatsApp `wa_outbox`
 * bridge with no rework. `onOpen(transporterId)` jumps to that hisab.
 */
import { fmtNum } from '../../core/utils/format'
import { thresholdLevel, transporterTotals, unsettledFrom } from './logic/calc'
import { levelStyle } from './logic/balance'
import { THRESHOLD_LEVELS } from './config'

/** Live balance for a transporter (prefer maintained runningBalance; fall back). */
export function balanceOf(t, { entries, advances, settlements }) {
  if (typeof t.runningBalance === 'number' && t.runningBalance !== 0) return t.runningBalance
  const from = unsettledFrom(settlements, t.id)
  return transporterTotals(entries, advances, t.id, { from }).balance
}

export default function ThresholdBanner({ transporters, state, onOpen }) {
  const flagged = (transporters || [])
    .filter(t => !t.deleted)
    .map(t => ({ t, bal: balanceOf(t, state), level: thresholdLevel(balanceOf(t, state), THRESHOLD_LEVELS) }))
    .filter(x => x.level > 0)
    .sort((a, b) => b.bal - a.bal)

  if (!flagged.length) return null
  const top = levelStyle(flagged[0].level)

  return (
    <div className={`${top.bg} ${top.text} rounded-2xl p-4 shadow-lg`}>
      <div className="font-bold text-sm mb-2">⚠️ Hisab piling up — clear soon</div>
      <div className="space-y-1.5">
        {flagged.map(({ t, bal, level }) => {
          const s = levelStyle(level)
          return (
            <button key={t.id} onClick={() => onOpen && onOpen(t.id)}
              className="w-full flex items-center justify-between bg-white/15 rounded-xl px-3 py-2 text-left active:scale-[0.99]">
              <span className="font-semibold truncate">{t.name}</span>
              <span className="font-mono font-bold flex items-center gap-2">₹{fmtNum(bal)} <span className={`${s.bg} ${s.text} text-[10px] rounded-full px-2 py-0.5`}>{s.label}</span></span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
