import { NextResponse } from "next/server";
import {
  createProduct,
  createProductInputSchema,
  listProducts,
  listPricedProductsForBranch,
} from "@/modules/catalog";
import { ValidationError } from "@/core/errors";
import {
  handle,
  handleMutation,
  parseJsonBody,
  requireOrganization,
} from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (branchId) {
      const products = await listPricedProductsForBranch(db, context.actor, branchId);
      return NextResponse.json({
        data: products.map((row) => ({
          id: row.product.id,
          code: row.product.code,
          name: row.product.name,
          productType: row.product.productType,
          status: row.product.status,
          amountMinor: row.amountMinor,
          currency: row.currency,
          priceScope: row.priceScope,
        })),
      });
    }
    const products = await listProducts(db, context.actor);
    return NextResponse.json({ data: products });
  });
}

export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, context } = await requireOrganization();
    const raw = await parseJsonBody(request);
    const input = createProductInputSchema.parse(raw);
    if (input.amountMinor == null) {
      throw new ValidationError("amountMinor is required");
    }
    const product = await createProduct(db, context.actor, input);
    return NextResponse.json({ data: product }, { status: 201 });
  });
}
