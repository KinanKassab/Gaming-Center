import { NextResponse } from "next/server";
import { getCustomerStatement, postCustomerLedgerEntry, postCustomerLedgerInputSchema } from "@/modules/finance";
import { handle, handleMutation, parseJsonBody, requireOrganization, uuidStringSchema } from "@/app/api/_lib/handler";

export async function GET(
  _request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  return handle(async () => {
    const { db, context: organization } = await requireOrganization();
    const { customerId } = await context.params;
    const statement = await getCustomerStatement(db, organization.actor, uuidStringSchema.parse(customerId));
    return NextResponse.json({ data: statement });
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  return handleMutation(request, async () => {
    const { db, context: organization } = await requireOrganization();
    const { customerId } = await context.params;
    const input = postCustomerLedgerInputSchema.parse(await parseJsonBody(request));
    const posted = await postCustomerLedgerEntry(
      db,
      organization.actor,
      uuidStringSchema.parse(customerId),
      input,
    );
    return NextResponse.json({ data: posted.statement, replayed: posted.replayed }, { status: posted.replayed ? 200 : 201 });
  });
}
