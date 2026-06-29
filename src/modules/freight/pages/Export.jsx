/**
 * Export — download freight entries as CSV for a date range (for accounts /
 * WhatsApp). Owner tool.
 */
import { useState } from 'react'
import { Button, Card, FieldLabel, DateInput, useToast, Toast } from '../../../core/ui'
import { todayStr, daysAgoStr, fmtDate } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { entryTotal } from '../logic/calc'

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export default function Export() {
  const { transporters, destinations, entries } = useFreight()
  const { msg, show } = useToast()
  const [from, setFrom] = useState(daysAgoStr(30))
  const [to, setTo] = useState(todayStr())

  const tName = (id) => transporters.list.find(t => t.id === id)?.name || ''
  const dName = (id) => destinations.list.find(d => d.id === id)?.name || ''

  const download = () => {
    const rows = (entries.list || []).filter(e => !e.deleted && (e.date || '') >= from && (e.date || '') <= to)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const header = ['Date', 'Transporter', 'Gaadi No', 'Transport', 'Bags', 'Pvt Marka', 'Freight', 'LR', 'Unloading', 'Misc', 'Extra Point', 'Total', 'Remarks']
    const body = rows.map(e => [fmtDate(e.date), tName(e.transporterId), e.gaadiNumber, dName(e.destinationId), e.bags, e.pvtMarka, e.freight, e.lrCharge, e.unloading, e.misc, e.extraPoint, entryTotal(e), e.remarks])
    const csv = [header, ...body].map(r => r.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `freight-${from}_to_${to}.csv`; a.click()
    URL.revokeObjectURL(a.href)
    show(`${rows.length} rows exported ✓`)
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Toast msg={msg} />
      <Card className="p-4 space-y-4">
        <div className="font-bold text-slate-700">Export entries (CSV)</div>
        <div className="grid grid-cols-2 gap-3">
          <div><FieldLabel>From</FieldLabel><div className="mt-1.5"><DateInput value={from} onChange={e => setFrom(e.target.value)} /></div></div>
          <div><FieldLabel>To</FieldLabel><div className="mt-1.5"><DateInput value={to} onChange={e => setTo(e.target.value)} /></div></div>
        </div>
        <Button variant="success" className="w-full" onClick={download}>⬇ Download CSV</Button>
      </Card>
    </div>
  )
}
