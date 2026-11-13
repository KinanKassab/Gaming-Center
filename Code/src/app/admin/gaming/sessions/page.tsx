import { HardRedirect } from "@/app/_components/hard-redirect";
import { retiredSessionsListHref } from "@/ui/admin-nav";

export default async function GamingSessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  const qs = params.toString();
  const href = retiredSessionsListHref(qs ? `?${qs}` : "");
  return <HardRedirect href={href} />;
}
