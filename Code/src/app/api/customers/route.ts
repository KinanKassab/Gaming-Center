import { NextResponse } from "next/server";
import {
  createCustomer,
  createCustomerInputSchema,
  listCustomerPage,
  listCustomersInputSchema,
} from "@/modules/customers";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

function numericQueryParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = listCustomersInputSchema.parse({
      q: url.searchParams.get("q") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: numericQueryParam(url.searchParams.get("limit")),
      offset: numericQueryParam(url.searchParams.get("offset")),
    });
    const page = await listCustomerPage(db, context.actor, input);
    return NextResponse.json({
      data: page.customers,
      pagination: { limit: page.limit, offset: page.offset, hasMore: page.hasMore },
    });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const input = createCustomerInputSchema.parse(await parseJsonBody(request));
    const result = await createCustomer(db, context.actor, input);
    return NextResponse.json({ data: result.customer, warnings: result.warnings }, { status: 201 });
  });
}
