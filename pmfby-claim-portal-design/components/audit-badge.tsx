"use client"

import { useId, useState } from 'react'
import { ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion, CircleCheck, TriangleAlert, CircleX, ChevronDown } from 'lucide-react'
import { auditTone, checkCounts, type AuditCheck, type AuditState, type AuditTone } from '@/lib/auditTypes'

const STATUS_UI: Record<AuditCheck['status'], { icon: typeof CircleCheck; color: string; label: string }> = {
  pass: { icon: CircleCheck, color: 'text-[#4f7a45]', label: 'Pass' },
  warn: { icon: TriangleAlert, color: 'text-[#a8761f]', label: 'Warning' },
  fail: { icon: CircleX, color: 'text-[#b03a2e]', label: 'Fail' },
}

const TONE_UI: Record<AuditTone, { box: string; chip: string; text: string; icon: typeof ShieldCheck }> = {
  green: { box: 'border-[#b9d0b0] bg-[#f1f7ee]', chip: 'bg-[#dcebd5] text-[#3f6b37]', text: 'text-[#3f6b37]', icon: ShieldCheck },
  amber: { box: 'border-[#e8d3a6] bg-[#fdf7ea]', chip: 'bg-[#f6e6c4] text-[#8a5f14]', text: 'text-[#8a5f14]', icon: ShieldAlert },
  red: { box: 'border-[#e7b9b2] bg-[#fcf1ef]', chip: 'bg-[#f6d9d4] text-[#a3362a]', text: 'text-[#a3362a]', icon: ShieldX },
}

/** "Auditor reviewing…" state with a small animated indicator. */
function Reviewing() {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border border-dashed border-[#c9d4bd] bg-[#fbfcf8] p-3">
      <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-[#eef4e9] text-[#5c7950]">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#cfe0c6] opacity-60" aria-hidden="true" />
        <ShieldQuestion className="relative size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-xs font-semibold text-[#3f6b37]">
          Auditor reviewing
          <span className="inline-flex gap-0.5" aria-hidden="true">
            {[0, 150, 300].map(delay => <span key={delay} className="size-1 animate-bounce rounded-full bg-current" style={{ animationDelay: `${delay}ms` }} />)}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">Checking the 72-hour window, crop, calamity, location and severity.</p>
      </div>
    </div>
  )
}

/** Verdict badge for the Cline PMFBY Compliance Auditor, with an expandable list of checks. */
export function AuditBadge({ audit }: { audit: AuditState }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (audit === null) return null
  if (audit === 'loading') return <Reviewing />

  if ('error' in audit) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-lg border border-[#e8d3a6] bg-[#fdf7ea] p-3 text-xs leading-5 text-[#7a5a1f]">
        <ShieldQuestion className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">Audit unavailable · manual review required</p>
          <p className="text-[11px] leading-4">The compliance auditor could not be reached ({audit.error}). You can still download the draft slip; it will say “Audit unavailable”.</p>
        </div>
      </div>
    )
  }

  const tone = auditTone(audit)
  const ui = TONE_UI[tone]
  const checks = audit.checks ?? []
  return (
    <div className={`rounded-lg border ${ui.box}`} aria-label={`Compliance audit: ${audit.audit_passed ? 'verified' : 'manual review required'}, score ${audit.compliance_score}`}>
      <div className="flex items-start gap-3 p-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${ui.chip}`}>
          <ui.icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs font-semibold ${ui.text}`}>{audit.audit_passed ? 'Verified by Autonomous Cline Auditor' : 'Manual review required'}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ui.chip}`}>{audit.compliance_score}</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{audit.audit_passed ? 'All PMFBY eligibility rules satisfied.' : audit.agent_stamp}</p>
        </div>
      </div>
      {checks.length > 0 && <>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center justify-between gap-2 border-t border-black/5 px-3 py-2 text-[11px] font-medium text-foreground/80 hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        >
          <span>{open ? 'Hide' : 'Show'} audit checks · {checkCounts(checks)}</span>
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {open && (
          <ul id={panelId} className="flex flex-col gap-2 border-t border-black/5 px-3 py-3">
            {checks.map(c => {
              const s = STATUS_UI[c.status]
              return (
                <li key={c.name} className="flex items-start gap-2 text-[11px] leading-4">
                  <s.icon className={`mt-px size-3.5 shrink-0 ${s.color}`} aria-label={s.label} />
                  <div className="min-w-0">
                    <span className="font-semibold tracking-wide">{c.name}</span>
                    <span className={`ml-1.5 text-[10px] font-semibold uppercase ${s.color}`}>{s.label}</span>
                    <p className="text-muted-foreground">{c.detail}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </>}
    </div>
  )
}
