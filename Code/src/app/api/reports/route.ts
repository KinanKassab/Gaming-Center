import { NextResponse } from "next/server";
import { getPilotOperationsReport, pilotReportInputSchema, pilotReportToCsv } from "@/modules/reports";
import { handle, requireOrganization } from "@/app/api/_lib/handler";

export async function GET(request: Request) {
  return handle(async () => {
    const { db, context } = await requireOrganization();
    const url = new URL(request.url);
    const input = pilotReportInputSchema.parse({
      branchId: url.searchParams.get("branchId") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });
    const report = await getPilotOperationsReport(db, context.actor, input);
    if (url.searchParams.get("format") === "csv") {
      const body = pilotReportToCsv(report);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="pilot-report${input.branchId ? `-${input.branchId}` : ""}.csv"`,
        },
      });
    }
    return NextResponse.json({ data: report });
  });
}
