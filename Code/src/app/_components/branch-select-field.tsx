import type { ChangeEventHandler } from "react";
import { shouldShowBranchPicker, soleBranchId } from "@/modules/gaming/branch-selection";

type BranchOption = { id: string; name: string };

/**
 * Branch chooser for filters and create forms.
 *
 * One accessible branch: hide the control. Create/submit forms still send that
 * id via a hidden input. Filter toolbars omit the field (`includeWhenSingle="omit"`)
 * so “all branches” stays the default. Two or more branches: show the select.
 */
export function BranchSelectField(props: {
  branches: ReadonlyArray<BranchOption>;
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  required?: boolean;
  emptyOptionLabel?: string;
  includeWhenSingle?: "hidden" | "omit";
  id?: string;
}) {
  const includeWhenSingle = props.includeWhenSingle ?? "hidden";
  if (!shouldShowBranchPicker(props.branches.length)) {
    if (includeWhenSingle === "omit") return null;
    const id = soleBranchId(props.branches);
    if (!id || !props.name) return null;
    return <input type="hidden" name={props.name} value={id} />;
  }

  const select =
    props.value !== undefined ? (
      <select
        id={props.id}
        name={props.name}
        value={props.value}
        onChange={props.onChange}
        required={props.required}
      >
        {selectOptions(props.branches, props.emptyOptionLabel)}
      </select>
    ) : (
      <select
        id={props.id}
        name={props.name}
        defaultValue={props.defaultValue}
        onChange={props.onChange}
        required={props.required}
      >
        {selectOptions(props.branches, props.emptyOptionLabel)}
      </select>
    );

  return (
    <label>
      {props.label}
      {select}
    </label>
  );
}

function selectOptions(branches: ReadonlyArray<BranchOption>, emptyOptionLabel: string | undefined) {
  return (
    <>
      {emptyOptionLabel ? <option value="">{emptyOptionLabel}</option> : null}
      {branches.map((branch) => (
        <option key={branch.id} value={branch.id}>
          {branch.name}
        </option>
      ))}
    </>
  );
}
