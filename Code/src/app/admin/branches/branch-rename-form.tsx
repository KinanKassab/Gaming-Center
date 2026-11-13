"use client";

import { ApiForm } from "@/app/admin/_components/controls";
import { useT } from "@/i18n/provider";

export function BranchRenameForm(props: { branchId: string; name: string }) {
  const t = useT();
  return (
    <ApiForm
      action={`/api/branches/${props.branchId}`}
      method="PATCH"
      submitLabel={t("branches.saveName")}
      fields={[{ name: "name", label: t("branches.name"), defaultValue: props.name }]}
    />
  );
}
