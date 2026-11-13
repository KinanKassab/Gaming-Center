"use client";

export function Toggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelledBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="ui-toggle"
      aria-checked={props.checked}
      {...(props.labelledBy ? { "aria-labelledby": props.labelledBy } : {})}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}
