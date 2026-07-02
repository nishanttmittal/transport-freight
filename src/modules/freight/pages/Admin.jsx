/**
 * Admin (owner) — Users & Access, JSON backup/export, and "Recalculate balances"
 * (rebuilds every transporter's running balance from raw entries+advances as a
 * safety net if an incremental update was ever missed). Guarded by PasswordGate.
 */
import { useState } from 'react'
import { Button, Card, TextInput, Select, PasswordGate, useToast, Toast } from '../../../core/ui'
import { fmtNum, todayStr } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { recomputeBalance, levelStyle } from '../logic/balance'
import { thresholdLevel } from '../logic/calc'
import { ADMIN_PASSWORD, THRESHOLD_LEVELS, OWNER_EMAILS } from '../config'

function Users() {
  const { users, transporters } = useFreight()
  const { msg, show } = useToast()
  const [form, setForm] = useState({ email: '', name: '', role: 'manager', transporterId: '' })
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const tActive = (transporters.list || []).filter(t => !t.deleted && t.active !== false)
  const tName = (id) => transporters.list.find(t => t.id === id)?.name || '—'
  const roleLabel = (r) => r === 'owner' ? 'Owner' : r === 'gaadiwala' ? 'Gaadiwala' : 'Staff'
  const add = () => {
    const email = form.email.trim().toLowerCase()
    if (!email) return show('Enter an email', 2000)
    if (form.role === 'gaadiwala' && !form.transporterId) return show('Pick which gaadiwala', 2200)
    users.insert({ email, name: form.name.trim(), role: form.role, transporterId: form.role === 'gaadiwala' ? form.transporterId : '', active: true })
    setForm({ email: '', name: '', role: 'manager', transporterId: '' }); show('User added ✓')
  }
  const list = (users.list || []).filter(u => !u.deleted)
  return (
    <Card className="p-4 space-y-3">
      <Toast msg={msg} />
      <div className="font-bold text-slate-700">Users &amp; Access</div>
      <p className="text-xs text-slate-400">Owner (you) is always {OWNER_EMAILS[0]}. Staff = enter/approve freight. Gaadiwala = his own login (submits trips for approval).</p>
      <TextInput value={form.email} placeholder="email@gmail.com" onChange={set('email')} />
      <div className="flex gap-2">
        <TextInput value={form.name} placeholder="Name" onChange={set('name')} />
        <Select options={[{ value: 'manager', label: 'Staff' }, { value: 'owner', label: 'Owner' }, { value: 'gaadiwala', label: 'Gaadiwala' }]} value={form.role} onChange={set('role')} className="max-w-[45%]" />
      </div>
      {form.role === 'gaadiwala' && (
        <Select options={[{ value: '', label: 'Link to which gaadiwala…' }, ...tActive.map(t => ({ value: t.id, label: t.name }))]} value={form.transporterId} onChange={set('transporterId')} />
      )}
      <Button onClick={add} className="w-full">Add user</Button>
      <div className="divide-y divide-slate-100">
        {list.map(u => (
          <div key={u.id} className="py-2.5 flex items-center gap-2">
            <div className="flex-1 min-w-0"><div className="font-semibold text-slate-800 truncate">{u.name || u.email}</div><div className="text-xs text-slate-400 truncate">{u.email} · {roleLabel(u.role)}{u.role === 'gaadiwala' && u.transporterId ? ` (${tName(u.transporterId)})` : ''}</div></div>
            <button onClick={() => users.update(u.id, { active: !(u.active !== false) })} className={`text-xs font-bold rounded-lg px-2.5 py-1.5 ${u.active !== false ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>{u.active !== false ? 'Active' : 'Off'}</button>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Tools() {
  const { transporters, destinations, entries, advances, settlements, users } = useFreight()
  const { msg, show } = useToast()

  const recalc = () => {
    const state = { entries: entries.list, advances: advances.list, settlements: settlements.list }
    let n = 0
    for (const t of transporters.list.filter(x => !x.deleted)) {
      const bal = recomputeBalance(state, t.id)
      transporters.update(t.id, { runningBalance: bal, alertedLevel: thresholdLevel(bal, THRESHOLD_LEVELS) })
      n++
    }
    show(`Recalculated ${n} balance${n === 1 ? '' : 's'} ✓`)
  }

  const backup = () => {
    const data = {
      app: 'transportfreight', exportedAt: new Date().toISOString(),
      transporters: transporters.list, destinations: destinations.list,
      entries: entries.list, advances: advances.list, settlements: settlements.list, users: users.list,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `freight-backup-${todayStr()}.json`; a.click()
    URL.revokeObjectURL(a.href)
    show('Backup downloaded ✓')
  }

  const rows = transporters.list.filter(t => !t.deleted).map(t => ({ t, lvl: thresholdLevel(t.runningBalance, THRESHOLD_LEVELS) }))

  return (
    <Card className="p-4 space-y-3">
      <Toast msg={msg} />
      <div className="font-bold text-slate-700">Tools</div>
      <Button variant="neutral" className="w-full" onClick={backup}>⬇ Download JSON backup</Button>
      <Button variant="neutral" className="w-full" onClick={recalc}>🔄 Recalculate all balances</Button>
      <div className="pt-2 text-xs text-slate-400">Maintained balances</div>
      <div className="divide-y divide-slate-100">
        {rows.map(({ t, lvl }) => (
          <div key={t.id} className="py-2 flex items-center justify-between">
            <span className="text-sm text-slate-700 truncate">{t.name}</span>
            <span className="flex items-center gap-2"><span className="font-mono font-bold text-slate-800">₹{fmtNum(t.runningBalance)}</span>{lvl > 0 && <span className={`${levelStyle(lvl).bg} ${levelStyle(lvl).text} text-[10px] rounded-full px-2 py-0.5`}>{levelStyle(lvl).label}</span>}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function Admin() {
  return (
    <PasswordGate password={ADMIN_PASSWORD} title="Admin Access">
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <Users />
        <Tools />
      </div>
    </PasswordGate>
  )
}
