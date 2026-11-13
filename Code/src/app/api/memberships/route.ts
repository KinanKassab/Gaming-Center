import { NextResponse } from "next/server";
import { z } from "zod";
import {
  attachUserByEmail,
  attachUserByEmailInputSchema,
  createUserWithMembership,
  createUserWithMembershipInputSchema,
  listMemberships,
} from "@/modules/identity";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import { handle, handleMutation, parseJsonBody, requireOrganization } from "@/app/api/_lib/handler";

export async function GET() {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const memberships = await listMemberships(db, context.actor);
    return NextResponse.json({ data: memberships });
  });
}

const createMembershipBodySchema = z.discriminatedUnion("mode", [
  createUserWithMembershipInputSchema.extend({ mode: z.literal("create") }),
  attachUserByEmailInputSchema.extend({ mode: z.literal("attach") }),
]);

/**
 * mode "create": provision a login (admin sets credentials) + ACTIVE membership.
 * mode "attach": INVITED membership for an existing account (user self-activates).
 */
export async function POST(request: Request) {
  return handleMutation(request, async () => {
    const { db, auth, context } = await requireOrganization();
    const body = createMembershipBodySchema.parse(await parseJsonBody(request));

    if (body.mode === "create") {
      const result = await createUserWithMembership(
        db,
        context.actor,
        { email: body.email, password: body.password, displayName: body.displayName },
        createAuthAccountProvisioner(auth),
      );
      return NextResponse.json({ data: result }, { status: 201 });
    }

    const result = await attachUserByEmail(db, context.actor, { email: body.email });
    return NextResponse.json({ data: result }, { status: 201 });
  });
}
