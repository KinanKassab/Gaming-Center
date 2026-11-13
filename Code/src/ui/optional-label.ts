/**
 * Optional-field presentation (BUG-034 / BUG-020).
 * FormField owns the locale marker. Catalog labels must not embed it.
 */

const EMBEDDED_OPTIONAL = /\(\s*optional\s*\)|\(\s*اختياري\s*\)/i;

export function catalogLabelHasEmbeddedOptional(label: string): boolean {
  return EMBEDDED_OPTIONAL.test(label);
}

/** Visible/accessible name when FormField appends the locale optional marker. */
export function formFieldVisibleName(label: string, optional: boolean, optionalWord: string): string {
  if (!optional) return label;
  return `${label} (${optionalWord})`;
}
