/** Helpers for the optional Azure Policy overlay (Microsoft's NIST 800-53 Rev 5 ownership + policy mapping). */
import type { AzureOverlay, AzureOwnership, EvidenceRecord } from '@shared/types';

export type AzureFilter = 'all' | AzureOwnership | 'none';

export const AZURE_LABEL: Record<AzureOwnership, string> = {
  shared: 'Shared',
  customer: 'Customer',
};

export const AZURE_ORIGINATION: Record<AzureOwnership, EvidenceRecord['origination']> = {
  shared: 'hybrid',
  customer: 'system_specific',
};

export const AZURE_HELP: Record<AzureOwnership, string> = {
  shared: 'Microsoft provides part of this control and the customer provides the rest. Applying it sets the origination to Hybrid.',
  customer: 'The customer owns this control; Azure only offers policies to help assess it. Applying it sets the origination to System-specific.',
};

/** True when a mapped policy can be evaluated by Azure itself rather than recording a manual attestation. */
export function isAutomatedPolicy(effects: string): boolean {
  return effects
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .some((e) => e && e !== 'manual' && e !== 'disabled');
}

export function matchesAzureFilter(overlay: AzureOverlay | undefined, filter: AzureFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return !overlay;
  return overlay?.ownership === filter;
}

/** The origination fields after applying the overlay, remembering the value to restore; null when nothing changes. */
export function applyAzureFields(
  record: Pick<EvidenceRecord, 'origination' | 'azurePriorOrigination'>,
  overlay: AzureOverlay,
): Pick<EvidenceRecord, 'origination' | 'azurePriorOrigination'> | null {
  const origination = AZURE_ORIGINATION[overlay.ownership];
  if (record.origination === origination) return null;
  return { origination, azurePriorOrigination: record.azurePriorOrigination ?? record.origination };
}

/** Undo is offered only while the overlay's value is still in effect, so later manual edits are never overwritten. */
export function isAzureApplied(
  record: Pick<EvidenceRecord, 'origination' | 'azurePriorOrigination'>,
  overlay: AzureOverlay,
): boolean {
  return record.azurePriorOrigination !== undefined && record.origination === AZURE_ORIGINATION[overlay.ownership];
}

export function undoAzureFields(
  record: Pick<EvidenceRecord, 'azurePriorOrigination'>,
): Pick<EvidenceRecord, 'origination' | 'azurePriorOrigination'> | null {
  return record.azurePriorOrigination ? { origination: record.azurePriorOrigination, azurePriorOrigination: undefined } : null;
}

export function applyAzureOverlay(record: EvidenceRecord, overlay: AzureOverlay): EvidenceRecord | null {
  const fields = applyAzureFields(record, overlay);
  return fields ? { ...record, ...fields, updatedAt: new Date().toISOString() } : null;
}

export function undoAzureOverlay(record: EvidenceRecord, overlay: AzureOverlay): EvidenceRecord | null {
  const fields = isAzureApplied(record, overlay) ? undoAzureFields(record) : null;
  return fields ? { ...record, ...fields, updatedAt: new Date().toISOString() } : null;
}
