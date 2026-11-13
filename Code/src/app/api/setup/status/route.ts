import { NextResponse } from "next/server";
import { isFirstUserRequired } from "@/modules/identity";
import { handle } from "@/app/api/_lib/handler";
import { getSafeRuntimeDb } from "@/db/client";

/** Whether the first-owner setup form should be offered. Not a security control. */
export async function GET() {
  return handle(async () => {
    const db = await getSafeRuntimeDb();
    return NextResponse.json({ data: { firstUserRequired: await isFirstUserRequired(db) } });
  });
}