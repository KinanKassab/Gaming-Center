import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "@/core/errors";
import { insertWithAllocatedCode, optionalInternalCode } from "@/core/codes";
import { createId } from "@/core/ids";
import { assertInt64Minor, parseMinorUnits, type MinorUnits } from "@/core/money";
import { assertPermission } from "@/core/tenancy";
import { catalogCategories, catalogProductPrices, catalogProducts, coreOrganizations } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { requireBranchAccess } from "@/modules/gaming/access";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRODUCT_TYPES = ["STOCK", "SERVICE", "NON_STOCK"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const createProductInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().max(32).optional(),
  categoryId: z.string().regex(UUID_PATTERN).optional().nullable(),
  productType: z.enum(PRODUCT_TYPES).default("NON_STOCK"),
  trackInventory: z.boolean().default(false),
  amountMinor: z.string().trim().regex(/^\d+$/, "amountMinor must be a non-negative integer string"),
  branchId: z.string().regex(UUID_PATTERN).optional().nullable(),
});

export type CreateProductInput = z.infer<typeof createProductInputSchema>;

export const setProductPriceInputSchema = z.object({
  productId: z.string().regex(UUID_PATTERN),
  amountMinor: z.string().trim().regex(/^\d+$/),
  branchId: z.string().regex(UUID_PATTERN).optional().nullable(),
});

export type SetProductPriceInput = z.infer<typeof setProductPriceInputSchema>;

export type CatalogProductRecord = typeof catalogProducts.$inferSelect;

export type PricedProduct = {
  product: CatalogProductRecord;
  amountMinor: string;
  currency: string;
  priceId: string;
  priceScope: "BRANCH" | "ORGANIZATION";
};

export type ResolvedProductPrice = {
  priceId: string;
  amountMinor: MinorUnits;
  currency: string;
  scope: "BRANCH" | "ORGANIZATION";
};

async function loadOrganizationCurrency(tx: AppDatabase, organizationId: string): Promise<string> {
  const rows = await tx
    .select({ currency: coreOrganizations.defaultCurrency })
    .from(coreOrganizations)
    .where(eq(coreOrganizations.id, organizationId))
    .limit(1);
  const currency = rows[0]?.currency;
  if (!currency) throw new NotFoundError("Organization not found");
  return currency;
}

async function loadOwnProduct(
  tx: AppDatabase,
  organizationId: string,
  productId: string,
): Promise<CatalogProductRecord> {
  const rows = await tx
    .select()
    .from(catalogProducts)
    .where(and(eq(catalogProducts.id, productId), eq(catalogProducts.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("Product not found");
  return row;
}

function priceWindowActive(at: Date) {
  return and(
    eq(catalogProductPrices.isActive, true),
    lte(catalogProductPrices.validFrom, at),
    or(isNull(catalogProductPrices.validTo), gt(catalogProductPrices.validTo, at)),
  );
}

/**
 * Branch override wins over organization default. No valid price → reject.
 */
export async function resolveProductPrice(
  tx: AppDatabase,
  input: { organizationId: string; productId: string; branchId: string; at?: Date },
): Promise<ResolvedProductPrice> {
  const at = input.at ?? new Date();
  const branchRows = await tx
    .select()
    .from(catalogProductPrices)
    .where(
      and(
        eq(catalogProductPrices.organizationId, input.organizationId),
        eq(catalogProductPrices.productId, input.productId),
        eq(catalogProductPrices.branchId, input.branchId),
        priceWindowActive(at),
      ),
    )
    .orderBy(desc(catalogProductPrices.validFrom))
    .limit(1);
  const branchPrice = branchRows[0];
  if (branchPrice) {
    return {
      priceId: branchPrice.id,
      amountMinor: branchPrice.amountMinor,
      currency: branchPrice.currency,
      scope: "BRANCH",
    };
  }

  const orgRows = await tx
    .select()
    .from(catalogProductPrices)
    .where(
      and(
        eq(catalogProductPrices.organizationId, input.organizationId),
        eq(catalogProductPrices.productId, input.productId),
        isNull(catalogProductPrices.branchId),
        priceWindowActive(at),
      ),
    )
    .orderBy(desc(catalogProductPrices.validFrom))
    .limit(1);
  const orgPrice = orgRows[0];
  if (!orgPrice) {
    throw new ConflictError("No active price for this product", "product_price_missing");
  }
  return {
    priceId: orgPrice.id,
    amountMinor: orgPrice.amountMinor,
    currency: orgPrice.currency,
    scope: "ORGANIZATION",
  };
}

export async function createProduct(
  db: AppDatabase,
  actor: OrganizationActor,
  input: CreateProductInput,
): Promise<CatalogProductRecord> {
  assertPermission(actor, PERMISSIONS.posCatalogManage);
  const parsed = createProductInputSchema.parse(input);
  if (parsed.trackInventory && parsed.productType === "NON_STOCK") {
    throw new ValidationError("NON_STOCK products cannot track inventory");
  }
  if (parsed.productType === "STOCK" && parsed.trackInventory) {
    throw new ValidationError("Inventory tracking is not available in this milestone", "inventory_not_implemented");
  }
  const amount = assertInt64Minor(parseMinorUnits(parsed.amountMinor));
  if (parsed.branchId) {
    requireBranchAccess(actor, parsed.branchId, "MANAGE");
  }

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    if (parsed.categoryId) {
      const cats = await tx
        .select({ id: catalogCategories.id })
        .from(catalogCategories)
        .where(
          and(
            eq(catalogCategories.id, parsed.categoryId),
            eq(catalogCategories.organizationId, actor.organizationId),
            eq(catalogCategories.status, "ACTIVE"),
          ),
        )
        .limit(1);
      if (!cats[0]) throw new NotFoundError("Category not found");
    }

    const currency = await loadOrganizationCurrency(tx, actor.organizationId);
    const productId = createId();
    const product = await insertWithAllocatedCode({
      explicit: optionalInternalCode(parsed.code),
      prefix: "P-",
      label: "Product code",
      conflictMessage: "Product code already exists",
      isUniqueViolation,
      insert: async (code) => {
        const inserted = await tx
          .insert(catalogProducts)
          .values({
            id: productId,
            organizationId: actor.organizationId,
            categoryId: parsed.categoryId ?? null,
            code,
            name: parsed.name.trim(),
            productType: parsed.productType,
            trackInventory: false,
            status: "ACTIVE",
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new ConflictError("Product was not created");
        return row;
      },
    });

    const priceId = createId();
    await tx.insert(catalogProductPrices).values({
      id: priceId,
      organizationId: actor.organizationId,
      productId: product.id,
      branchId: parsed.branchId ?? null,
      currency,
      amountMinor: amount,
      isActive: true,
    });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: parsed.branchId ?? null,
      actorUserId: actor.userId,
      action: "pos.catalog.product.created",
      entityType: "catalog_product",
      entityId: product.id,
      after: {
        code: product.code,
        name: product.name,
        productType: product.productType,
        amountMinor: amount.toString(),
        currency,
        priceScope: parsed.branchId ? "BRANCH" : "ORGANIZATION",
      },
    });

    return product;
  });
}

export async function setProductPrice(
  db: AppDatabase,
  actor: OrganizationActor,
  input: SetProductPriceInput,
): Promise<{ priceId: string; amountMinor: string; currency: string }> {
  assertPermission(actor, PERMISSIONS.posCatalogManage);
  const parsed = setProductPriceInputSchema.parse(input);
  const amount = assertInt64Minor(parseMinorUnits(parsed.amountMinor));
  if (parsed.branchId) {
    requireBranchAccess(actor, parsed.branchId, "MANAGE");
  }

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    await loadOwnProduct(tx, actor.organizationId, parsed.productId);
    const currency = await loadOrganizationCurrency(tx, actor.organizationId);
    const now = new Date();

    // Close previous active rows for the same scope by inserting a successor only
    // (prices are immutable; deactivate via valid_to on a new insert path is not
    // available without UPDATE). New is_active row coexists; resolver uses latest
    // valid_from. Mark prior active rows inactive is an UPDATE — prices are
    // append-only. Resolver picks latest valid_from within window.
    const priceId = createId();
    await tx.insert(catalogProductPrices).values({
      id: priceId,
      organizationId: actor.organizationId,
      productId: parsed.productId,
      branchId: parsed.branchId ?? null,
      currency,
      amountMinor: amount,
      validFrom: now,
      isActive: true,
    });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: parsed.branchId ?? null,
      actorUserId: actor.userId,
      action: "pos.catalog.price.set",
      entityType: "catalog_product",
      entityId: parsed.productId,
      after: {
        priceId,
        amountMinor: amount.toString(),
        currency,
        priceScope: parsed.branchId ? "BRANCH" : "ORGANIZATION",
      },
    });

    return { priceId, amountMinor: amount.toString(), currency };
  });
}

export async function listPricedProductsForBranch(
  db: AppDatabase,
  actor: OrganizationActor,
  branchId: string,
): Promise<PricedProduct[]> {
  assertPermission(actor, PERMISSIONS.posCatalogRead);
  requireBranchAccess(actor, branchId, "VIEW");

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const products = await tx
      .select()
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.organizationId, actor.organizationId),
          eq(catalogProducts.status, "ACTIVE"),
        ),
      )
      .orderBy(catalogProducts.name);

    const priced: PricedProduct[] = [];
    for (const product of products) {
      try {
        const price = await resolveProductPrice(tx, {
          organizationId: actor.organizationId,
          productId: product.id,
          branchId,
        });
        priced.push({
          product,
          amountMinor: price.amountMinor.toString(),
          currency: price.currency,
          priceId: price.priceId,
          priceScope: price.scope,
        });
      } catch {
        // Skip products without a resolvable price for this branch.
      }
    }
    return priced;
  });
}

export async function listProducts(
  db: AppDatabase,
  actor: OrganizationActor,
): Promise<CatalogProductRecord[]> {
  assertPermission(actor, PERMISSIONS.posCatalogRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) =>
    tx
      .select()
      .from(catalogProducts)
      .where(eq(catalogProducts.organizationId, actor.organizationId))
      .orderBy(catalogProducts.name),
  );
}

export async function getProduct(
  db: AppDatabase,
  actor: OrganizationActor,
  productId: string,
): Promise<CatalogProductRecord> {
  assertPermission(actor, PERMISSIONS.posCatalogRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
    loadOwnProduct(tx, actor.organizationId, productId),
  );
}
