/**
 * Hisab statement PDF + native share (WhatsApp). One page: a transporter's
 * dated freight + advance lines with a running balance, then the settlement
 * totals. Used by the Hisab screen on Settle and on "Share statement".
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDate, fmtNum, todayStr } from '../../../core/utils/format'
import { APP_TITLE, fmtChallan } from '../config'

const STEEL = [30, 41, 59]
const SLATE = [100, 116, 139]

/**
 * Build a transporter hisab statement.
 * @param {object} a
 * @param {string} a.transporterName
 * @param {Array}  a.lines  ledgerLines() output (date, kind, amount, debit, credit, balance, ...)
 * @param {function} a.destName  (destinationId) => display name
 * @param {object} a.totals { freight, advances, balance }
 * @param {object} a.period { from, to }
 * @returns {{doc: jsPDF, filename: string}}
 */
export function buildStatementPdf({ transporterName, lines, destName, totals, period }) {
  const doc = new jsPDF('p', 'pt', 'a4')
  doc.setFontSize(16); doc.setTextColor(...STEEL); doc.setFont(undefined, 'bold')
  doc.text(APP_TITLE, 40, 42)
  doc.setFontSize(13)
  doc.text(`Hisab — ${transporterName || '—'}`, 40, 64)
  doc.setFontSize(10); doc.setTextColor(...SLATE); doc.setFont(undefined, 'normal')
  const periodTxt = period && (period.from || period.to)
    ? `${period.from ? fmtDate(period.from) : 'start'} to ${period.to ? fmtDate(period.to) : fmtDate(todayStr())}`
    : `up to ${fmtDate(todayStr())}`
  doc.text(`Period: ${periodTxt}`, 40, 80)

  const body = (lines || []).map(l => l.kind === 'advance'
    ? ['', fmtDate(l.date), 'Advance', l.paidBy ? `Paid by ${l.paidBy}` : (l.note || ''), '', `-${fmtNum(l.amount)}`, fmtNum(l.balance)]
    : [fmtChallan(l.challanNo), fmtDate(l.date), 'Freight', `${destName ? destName(l.destinationId) : ''}${l.gaadiNumber ? ' · ' + l.gaadiNumber : ''}`, fmtNum(l.debit), '', fmtNum(l.balance)])

  autoTable(doc, {
    startY: 96,
    head: [['Challan', 'Date', 'Type', 'Details', 'Freight ₹', 'Advance ₹', 'Balance ₹']],
    body: body.length ? body : [['—', '—', '', 'No activity in this period', '', '', '']],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: STEEL, textColor: 255 },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  })

  let y = (doc.lastAutoTable?.finalY || 96) + 24
  doc.setFontSize(11); doc.setTextColor(...STEEL); doc.setFont(undefined, 'normal')
  const line = (label, val) => { doc.text(label, 360, y, { align: 'right' }); doc.text(`₹ ${fmtNum(val)}`, 555, y, { align: 'right' }); y += 18 }
  line('Total Freight', totals.freight)
  line('Less Advances', totals.advances)
  doc.setFont(undefined, 'bold'); doc.setFontSize(13)
  doc.text('Balance Due', 360, y, { align: 'right' }); doc.text(`₹ ${fmtNum(totals.balance)}`, 555, y, { align: 'right' })

  doc.setFontSize(8); doc.setTextColor(...SLATE); doc.setFont(undefined, 'normal')
  doc.text(`Generated ${fmtDate(todayStr())} · UNICO / NSP`, 40, 812)

  const filename = `Hisab-${(transporterName || 'transporter').replace(/[^A-Za-z0-9]+/g, '_')}-${todayStr()}.pdf`
  return { doc, filename }
}

/** SHA-256 hex of the generated statement — stored on the settlement so the paid
 *  figure is provable later. Returns '' if Web Crypto is unavailable. */
export async function statementHash(args) {
  try {
    const { doc } = buildStatementPdf(args)
    const buf = doc.output('arraybuffer')
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { return '' }
}

/** Download (and try to native-share) a built statement PDF. */
export async function shareStatementPdf(args) {
  const { doc, filename } = buildStatementPdf(args)
  try {
    const blob = doc.output('blob')
    const file = new File([blob], filename, { type: 'application/pdf' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return
    }
  } catch { /* fall through to download */ }
  doc.save(filename)
}
