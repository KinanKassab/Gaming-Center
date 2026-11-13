import { NextResponse } from "next/server";
import {
  clearOrganizationSetting,
  requireSettingKey,
  setOrganizationSetting,
  setSettingValueInputSchema,
} from "@/modules/settings";
import { handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function PUT(request: Request, context: { params: Promise<{ key: string }> }) {
  return handleMutation(request, async () => {
    const { key } = await context.params;
    const settingKey = requireSettingKey(key);
    const { db, context: organizationContext } = await requireOrganization();
    const input = setSettingValueInputSchema.parse(await parseJsonBody(request));
    const result = await setOrganizationSetting(db, organizationContext.actor, settingKey, input);
    return NextResponse.json({ data: result });
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ key: string }> }) {
  return handleMutation(request, async () => {
    const { key } = await context.params;
    const settingKey = requireSettingKey(key);
    const { db, context: organizationContext } = await requireOrganization();
    const result = await clearOrganizationSetting(db, organizationContext.actor, settingKey);
    return NextResponse.json({ data: result });
  });
}
