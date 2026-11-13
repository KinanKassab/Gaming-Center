import { NextResponse } from "next/server";
import {
  clearBranchSetting,
  requireSettingKey,
  setBranchSetting,
  setSettingValueInputSchema,
} from "@/modules/settings";
import {
  handleMutation,
  parseJsonBody,
  requireOrganization,
  requireUuidParam,
} from "@/app/api/_lib/handler";

export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string; branchId: string }> },
) {
  return handleMutation(request, async () => {
    const { key, branchId } = await context.params;
    const settingKey = requireSettingKey(key);
    const id = requireUuidParam(branchId, "Branch");
    const { db, context: organizationContext } = await requireOrganization();
    const input = setSettingValueInputSchema.parse(await parseJsonBody(request));
    const result = await setBranchSetting(db, organizationContext.actor, settingKey, id, input);
    return NextResponse.json({ data: result });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ key: string; branchId: string }> },
) {
  return handleMutation(request, async () => {
    const { key, branchId } = await context.params;
    const settingKey = requireSettingKey(key);
    const id = requireUuidParam(branchId, "Branch");
    const { db, context: organizationContext } = await requireOrganization();
    const result = await clearBranchSetting(db, organizationContext.actor, settingKey, id);
    return NextResponse.json({ data: result });
  });
}
