"use client"

import { ShieldCheck, ShieldAlert, Loader2, CircleCheck, TriangleAlert, CircleX } from 'lucide-react'
import type { AuditCheck } from '@/lib/generateClaimSlip'
import type { AuditState } from '@/components/claim-portal'

const STATUS_UI: Record<AuditCheck['status'], { icon: typeof CircleCheck; color: string; label: string }> = {
  pass: { icon: CircleCheck, color: 'text-[#4f7a45]', label: 'Pass' },
  warn: { icon: TriangleAlert, color: 'text-[#a8761f]', label: 'Warning' },
  fail: { icon: CircleX, color: 'text-[#b03a2e]', label: 'Fail' },
}

/** Verification badge for the Cline PMFBY Compliance Auditor verdict. */
export function AuditBadge({ audit }: { audit: AuditState }) {
  if (audit === null) return null

  if (audit === 'loading') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        <span>Cline Compliance Auditor is verifying your claim against PMFBY rules…</span>
      </div>
    )
  }

  if ('error' in audit) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-lg border border-[#e8d9b7] bg-[#fbf8f0] p-3 text-xs leading-5 text-[#7a5a1f]">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>Compliance audit could not be completed ({audit.error}). Your claim details are still saved in this slip.</span>
      </div>
    )
  }

  const ok = audit.audit_passed
  const Icon = ok ? ShieldCheck : ShieldAlert
  return (
    <div
      className={`rounded-lg border p-3 ${ok ? 'border-[#b9d0b0] bg-[#f1f7ee]' : 'border-[#e7b9b2] bg-[#fcf1ef]'}`}
      aria-label={`Compliance audit ${ok ? 'passed' : 'flagged'}`}
    >
      <div className="flex items-start gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${ok ? 'bg-[#dcebd5] text-[#3f6b37]' : 'bg-[#f6d9d4] text-[#a3362a]'}`}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs font-semibold ${ok ? 'text-[#3f6b37]' : 'text-[#a3362a]'}`}>{ok ? 'Audit passed' : 'Audit flagged'}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? 'bg-[#dcebd5] text-[#3f6b37]' : 'bg-[#f6d9d4] text-[#a3362a]'}`}>{audit.compliance_score}</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-foreground">{audit.agent_stamp}</p>
        </div>
      </div>
      {audit.checks && audit.checks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-black/5 pt-3">
          {audit.checks.map((c) => {
            const s = STATUS_UI[c.status]
            return (
              <li key={c.name} className="flex items-start gap-2 text-[11px] leading-4">
                <s.icon className={`mt-px size-3.5 shrink-0 ${s.color}`} aria-label={s.label} />
                <span className="w-[92px] shrink-0 font-semibold tracking-wide">{c.name}</span>
                <span className="text-muted-foreground">{c.detail}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
