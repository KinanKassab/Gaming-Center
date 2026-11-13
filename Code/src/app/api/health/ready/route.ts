import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getSafeRuntimeDb } from "@/db/client";
import { logError } from "@/core/log";

export const runtime = "nodejs";

/**
 * Readiness: the Function can reach PostgreSQL as gaming_app.
 * Checks getSafeRuntimeDb() then a minimal round-trip. Body stays generic.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const db = await getSafeRuntimeDb();
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    logError("health.ready.failed", error, { route: "/api/health/ready" });
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
