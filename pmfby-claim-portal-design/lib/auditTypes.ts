import type { AuditResult } from './generateClaimSlip'

/** One step of the Cline PMFBY Compliance Auditor (/api/cline-audit). */
export interface AuditCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

/** Full verdict from /api/cline-audit. Compatible with the PDF's AuditResult. */
export interface AuditVerdict extends AuditResult {
  checks: AuditCheck[]
  audited_at: string
}

/** UI state of the audit for the current draft. */
export type AuditState = AuditVerdict | 'loading' | { error: string } | null
