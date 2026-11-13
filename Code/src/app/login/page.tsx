import { getSafeRuntimeDb } from "@/db/client";
import { isFirstUserRequired } from "@/modules/identity";
import { authenticatedEntryHref } from "@/auth/entry";
import { loginCredentialQueryRedirect } from "@/auth/login-form-safety";
import { LoginForm } from "@/app/login/login-form";
import { HardRedirect } from "@/app/_components/hard-redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const leakedQueryRedirect = loginCredentialQueryRedirect(query);
  if (leakedQueryRedirect) {
    return <HardRedirect href={leakedQueryRedirect} />;
  }
  const entry = await authenticatedEntryHref();
  if (entry) return <HardRedirect href={entry} />;
  const db = await getSafeRuntimeDb();
  const firstUserRequired = await isFirstUserRequired(db);
  return <LoginForm firstUserRequired={firstUserRequired} />;
}
