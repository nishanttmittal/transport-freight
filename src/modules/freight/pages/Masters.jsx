/**
 * Masters — manage the Transporters and Destinations (transport offices) lists
 * that feed the Entry dropdowns. Soft-delete only (records keep history). The
 * "no re-typing transport names" requirement lives here.
 */
import { useState } from 'react'
import { Button, Card, TextInput, useToast, Toast } from '../../../core/ui'
import { useFreight } from '../FreightContext'

const active = (list) => (list || []).filter(x => !x.deleted)

function MasterList({ title, repo, withPhone }) {
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
  const softDelete = (id, n) => { if (window.confirm(`Remove ${n}? (history is kept)`)) repo.update(id, { deleted: true }) }

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
        {list.map(r => (
          <div key={r.id} className="py-2.5 flex items-center gap-2">
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
                <button onClick={() => softDelete(r.id, r.name)} className="text-xs font-bold text-red-500 bg-red-50 rounded-lg px-2.5 py-1.5">Remove</button>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function Masters() {
  const { transporters, destinations } = useFreight()
  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <MasterList title="Gaadiwalas" repo={transporters} withPhone />
      <MasterList title="Destinations" repo={destinations} />
    </div>
  )
}
