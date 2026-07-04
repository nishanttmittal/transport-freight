/**
 * Masters — manage the Gaadiwalas and Destinations (transport offices) lists
 * that feed the Entry dropdowns. Soft-delete only (records keep history).
 * For gaadiwalas, the OWNER can also attach an app LOGIN (his Gmail) right here —
 * this creates/updates a `users` doc (role=gaadiwala, linked to this transporter),
 * the same thing Admin → Users & Access does, but where you actually add gaadiwalas.
 */
import { useState } from 'react'
import { Button, Card, TextInput, useToast, Toast } from '../../../core/ui'
import { useFreight } from '../FreightContext'
import { transporterDeleteBlock } from '../logic/calc'

const active = (list) => (list || []).filter(x => !x.deleted)

function MasterList({ title, repo, withPhone, withLogin, owner, users, deleteOwnerOnly = false, deleteGuard = null }) {
  const { msg, show } = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [editId, setEditId] = useState('')
  const [editName, setEditName] = useState('')

  const add = () => {
    const n = name.trim()
    if (!n) return
    repo.insert(withPhone ? { name: n, phone: phone.trim(), active: true, runningBalance: 0, alertedLevel: 0, deleted: false } : { name: n, active: true, deleted: false })
    setName(''); setPhone(''); show('Added ✓')
  }
  const saveEdit = (id) => { if (editName.trim()) repo.update(id, { name: editName.trim() }); setEditId('') }
  const softDelete = (r) => {
    const g = deleteGuard ? deleteGuard(r) : {}
    // Never remove a gaadiwala who still has money owed or trip history — it
    // would hide a live payable from the dashboard (P1-4).
    if (g.blocked) return show(`Can’t remove ${r.name} — ${g.blocked}. It stays so the hisab is correct.`, 3600)
    const warn = g.warn ? `\n\n⚠️ ${g.warn}` : ''
    if (window.confirm(`Remove ${r.name}? (history is kept)${warn}`)) repo.update(r.id, { deleted: true })
  }

  // Login helpers (owner only) — the linked login for a gaadiwala is a users doc.
  const loginFor = (r) => (users?.list || []).find(u => !u.deleted && u.active !== false && u.role === 'gaadiwala' && u.transporterId === r.id)
  const giveLogin = (r) => {
    const email = (window.prompt(`App login for ${r.name}\n\nEnter his Google (Gmail) address:`) || '').trim().toLowerCase()
    if (!email) return
    if (!email.includes('@') || !email.includes('.')) return show('That doesn’t look like an email', 2200)
    const existing = (users.list || []).find(u => (u.email || '').toLowerCase() === email)
    // Always write the user doc keyed by email — the rules resolve role via
    // users/{email}. (Self-heals any legacy random-id doc by retiring it.)
    users.insert({ id: email, email, name: r.name, role: 'gaadiwala', transporterId: r.id, active: true, deleted: false })
    if (existing && existing.id !== email) users.update(existing.id, { active: false, deleted: true })
    show('Login added ✓ — he can now sign in with that Gmail', 2600)
  }
  const removeLogin = (login) => { if (window.confirm(`Remove ${login.email}'s login? He won’t be able to sign in.`)) users.update(login.id, { active: false }) }

  const list = active(repo.list).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <Card className="p-4 space-y-3">
      <Toast msg={msg} />
      <div className="font-bold text-slate-700">{title}</div>
      <div className="flex gap-2">
        <TextInput value={name} placeholder={`New ${title.toLowerCase()} name`} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        {withPhone && <TextInput value={phone} placeholder="Phone" onChange={e => setPhone(e.target.value)} className="max-w-[40%]" />}
        <Button onClick={add}>Add</Button>
      </div>
      <div className="divide-y divide-slate-100">
        {list.length === 0 && <div className="py-4 text-center text-slate-400 text-sm">None yet.</div>}
        {list.map(r => {
          const login = withLogin && owner ? loginFor(r) : null
          return (
            <div key={r.id} className="py-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                {editId === r.id ? (
                  <>
                    <TextInput value={editName} autoFocus onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveEdit(r.id)} />
                    <Button size="sm" onClick={() => saveEdit(r.id)}>Save</Button>
                    <Button size="sm" variant="neutral" onClick={() => setEditId('')}>✕</Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0"><div className="font-semibold text-slate-800 truncate">{r.name}</div>{r.phone && <div className="text-xs text-slate-400">{r.phone}</div>}</div>
                    <button onClick={() => { setEditId(r.id); setEditName(r.name) }} className="text-xs font-bold text-slate-500 bg-slate-100 rounded-lg px-2.5 py-1.5">Edit</button>
                    {(!deleteOwnerOnly || owner) && <button onClick={() => softDelete(r)} className="text-xs font-bold text-red-500 bg-red-50 rounded-lg px-2.5 py-1.5">Remove</button>}
                  </>
                )}
              </div>
              {withLogin && owner && editId !== r.id && (
                login
                  ? <div className="flex items-center gap-2 pl-0.5">
                      <span className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-2 py-1 truncate">📱 login: {login.email}</span>
                      <button onClick={() => removeLogin(login)} className="text-[11px] font-bold text-red-500">remove login</button>
                    </div>
                  : <button onClick={() => giveLogin(r)} className="text-xs font-bold text-indigo-600 bg-indigo-50 rounded-lg px-2.5 py-1.5">＋ Give app login (add Gmail)</button>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default function Masters({ owner = false }) {
  const { transporters, destinations, entries, users } = useFreight()
  const hasEntriesFor = (field, id) => (entries.list || []).some(e => !e.deleted && e[field] === id)
  const gaadiwalaGuard = (r) => ({ blocked: transporterDeleteBlock({ runningBalance: r.runningBalance, hasEntries: hasEntriesFor('transporterId', r.id) }) })
  const destinationGuard = (r) => ({ warn: hasEntriesFor('destinationId', r.id) ? 'This transport is used in existing trips.' : '' })
  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <MasterList title="Gaadiwalas" repo={transporters} withPhone withLogin owner={owner} users={users} deleteOwnerOnly deleteGuard={gaadiwalaGuard} />
      <MasterList title="Destinations" repo={destinations} deleteGuard={destinationGuard} />
      {!owner && <p className="text-center text-[11px] text-slate-400">Giving a gaadiwala an app login is owner-only.</p>}
    </div>
  )
}
