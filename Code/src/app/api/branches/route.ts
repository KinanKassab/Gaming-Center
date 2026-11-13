import { NextResponse } from "next/server";
import { createBranch, createBranchInputSchema, listBranches } from "@/modules/identity";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET() {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const branches = await listBranches(db, context.actor);
    return NextResponse.json({ data: branches });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createBranchInputSchema.parse(await parseJsonBody(request));
    const branch = await createBranch(db, context.actor, input);
    return NextResponse.json({ data: branch }, { status: 201 });
  });
}
