import { getSafeRuntimeDb } from "@/db/client";
import { isFirstUserRequired } from "@/modules/identity";
import { resolveSetupPageNavigation } from "@/auth/setup-form-safety";
import { redirectDiscardingRequestBody } from "@/auth/setup-page-redirect";
import { SetupForm } from "@/app/setup/setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const db = await getSafeRuntimeDb();
  const destination = resolveSetupPageNavigation({
    firstUserRequired: await isFirstUserRequired(db),
    searchParams: query,
  });
  if (destination) {
    redirectDiscardingRequestBody(destination);
  }
  return <SetupForm />;
}
