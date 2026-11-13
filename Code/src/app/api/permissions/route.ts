import { NextResponse } from "next/server";
import { listPermissionCatalog } from "@/modules/identity";
import { handle, requireOrganization } from "@/app/api/_lib/handler";

export async function GET() {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const permissions = await listPermissionCatalog(db, context.actor);
    return NextResponse.json({ data: permissions });
  });
}
