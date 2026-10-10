/** One step of the Cline PMFBY Compliance Auditor (/api/cline-audit). */
export interface AuditCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

/** Audit verdict as accepted by the PDF (checks/timestamp optional for older callers). */
export interface AuditResult {
  audit_passed: boolean
  compliance_score: string
  agent_stamp: string
  audit_log: string
  checks?: AuditCheck[]
  audited_at?: string
}

/** Full verdict from /api/cline-audit. */
export interface AuditVerdict extends AuditResult {
  checks: AuditCheck[]
  audited_at: string
}

/** UI state of the audit for the current draft. */
export type AuditState = AuditVerdict | 'loading' | { error: string } | null

/**
 * Visual severity shared by the badge and the PDF:
 * - green: audit passed (warnings allowed)
 * - red:   a hard eligibility rule failed (72-hr window, crop, calamity)
 * - amber: only soft checks failed (GPS, consistency), so manual review may clear it
 */
export type AuditTone = 'green' | 'amber' | 'red'
export const HARD_CHECKS = ['WINDOW', 'CROP', 'CALAMITY']

export function auditTone(audit: AuditResult): AuditTone {
  if (audit.audit_passed) return 'green'
  const hardFail = (audit.checks ?? []).some(c => c.status === 'fail' && HARD_CHECKS.includes(c.name))
  // Without a checks list we cannot tell which rule failed, so treat it as red.
  return hardFail || !audit.checks?.length ? 'red' : 'amber'
}

/** "4 passed · 1 warning · 0 failed" */
export function checkCounts(checks: AuditCheck[]): string {
  const n = (s: AuditCheck['status']) => checks.filter(c => c.status === s).length
  const warn = n('warn')
  return `${n('pass')} passed · ${warn} warning${warn === 1 ? '' : 's'} · ${n('fail')} failed`
}
