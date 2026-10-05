/**
 * Baseline membership. Two independent sources of truth:
 *
 *  - NIST 800-53B: `nist_800_53.baselines` is a plain array of levels.
 *  - VA 6500 overlay: `va_overlay.va_baseline_allocation` is free text per level,
 *    e.g. `"AC-2 (1)(2)(3)(4)"`, `"AC-19(5)"`, `"Not Selected"`, or absent.
 *    A present, non-"Not Selected" string means the control is selected at that
 *    level; the parenthesised numbers are the enhancements selected with it.
 *
 * The two disagree in places — VA pulls AC-19(5) down to Low, which 800-53B puts
 * at Moderate — so the mode is a user-facing toggle, not a merge.
 */
import type {
  Baseline,
  BaselineFilter,
  CatalogControl,
  CatalogEnhancement,
  FrameworkMode,
  VaBaselineAllocation,
} from '@shared/types';

export interface VaAllocation {
  selected: boolean;
  enhancements: number[];
}

const NOT_SELECTED = /^not\s*selected$/i;

export function parseVaAllocation(raw?: string): VaAllocation {
  const value = (raw ?? '').trim();
  if (!value || NOT_SELECTED.test(value)) return { selected: false, enhancements: [] };
  return {
    selected: true,
    enhancements: [...value.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1])),
  };
}

function allocationFor(alloc: VaBaselineAllocation | undefined, baseline: Baseline): string | undefined {
  if (!alloc) return undefined;
  return baseline === 'Low' ? alloc.low : baseline === 'Moderate' ? alloc.moderate : alloc.high;
}

/** `AC-2(1)` -> 1 */
export function enhancementNumber(enhancementId: string): number | null {
  const m = /\((\d+)\)/.exec(enhancementId);
  return m ? Number(m[1]) : null;
}

export function isSelectable(status: string): boolean {
  return status === 'active';
}

export function isControlInBaseline(
  control: CatalogControl,
  baseline: BaselineFilter,
  mode: FrameworkMode,
): boolean {
  if (!isSelectable(control.status)) return false;
  if (baseline === 'All') return true;
  if (mode === 'nist') return control.nist_800_53.baselines.includes(baseline);
  if (!control.va_overlay?.applies) return false;
  return parseVaAllocation(allocationFor(control.va_overlay.va_baseline_allocation, baseline)).selected;
}

/**
 * An enhancement counts as selected if its own allocation says so, or — when it
 * carries no allocation of its own — if the parent control's allocation string
 * lists its number.
 */
export function isEnhancementInBaseline(
  control: CatalogControl,
  enhancement: CatalogEnhancement,
  baseline: BaselineFilter,
  mode: FrameworkMode,
): boolean {
  if (!isSelectable(enhancement.status)) return false;
  if (baseline === 'All') return true;

  if (mode === 'nist') return enhancement.nist_800_53.baselines.includes(baseline);

  if (enhancement.va_overlay?.applies === false) return false;

  const own = allocationFor(enhancement.va_overlay?.va_baseline_allocation, baseline);
  if (own !== undefined) return parseVaAllocation(own).selected;

  const number = enhancementNumber(enhancement.enhancement_id);
  if (number === null) return false;
  const parent = parseVaAllocation(allocationFor(control.va_overlay?.va_baseline_allocation, baseline));
  return parent.selected && parent.enhancements.includes(number);
}

export function selectedEnhancements(
  control: CatalogControl,
  baseline: BaselineFilter,
  mode: FrameworkMode,
): CatalogEnhancement[] {
  return (control.control_enhancements ?? []).filter((e) =>
    isEnhancementInBaseline(control, e, baseline, mode),
  );
}

/** Short label for the baseline column, e.g. `L/M/H` or `M/H`. */
export function baselineLabel(control: CatalogControl, mode: FrameworkMode): string {
  const levels: Baseline[] = ['Low', 'Moderate', 'High'];
  const marks = levels
    .filter((level) =>
      mode === 'nist'
        ? control.nist_800_53.baselines.includes(level)
        : parseVaAllocation(allocationFor(control.va_overlay?.va_baseline_allocation, level)).selected,
    )
    .map((level) => level[0]);
  return marks.length ? marks.join('/') : '—';
}

/** Flags controls where the VA overlay selects a level that 800-53B does not. */
export function overlayDivergence(control: CatalogControl): Baseline[] {
  const levels: Baseline[] = ['Low', 'Moderate', 'High'];
  return levels.filter((level) => {
    const nist = control.nist_800_53.baselines.includes(level);
    const va = parseVaAllocation(allocationFor(control.va_overlay?.va_baseline_allocation, level)).selected;
    return va !== nist;
  });
}
