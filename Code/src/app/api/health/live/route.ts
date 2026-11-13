import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Liveness: the Function invocation succeeds. No dependency checks. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok" });
}
