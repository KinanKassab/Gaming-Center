/**
 * URL contract for SelectAction. Server Components pass this as a plain string
 * (RSC cannot serialize functions into Client Components).
 */
export const SELECT_ACTION_VALUE_PLACEHOLDER = "{value}";

/**
 * Substitutes the selected option into a static URL template.
 * The selected value comes from the Client Component after the user picks it.
 */
export function resolveSelectActionUrl(actionTemplate: string, selectedValue: string): string {
  const parts = actionTemplate.split(SELECT_ACTION_VALUE_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error("SelectAction actionTemplate must contain exactly one {value} placeholder");
  }
  if (selectedValue.length === 0) {
    throw new Error("SelectAction requires a selected value");
  }
  if (selectedValue.includes(SELECT_ACTION_VALUE_PLACEHOLDER)) {
    throw new Error("SelectAction selected value is invalid");
  }
  return `${parts[0]}${selectedValue}${parts[1]}`;
}
