export function customerPageHref(page: number, q: string, status: string | undefined): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/customers?${query}` : "/admin/customers";
}
