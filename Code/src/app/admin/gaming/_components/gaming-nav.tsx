import Link from "next/link";
import { PERMISSIONS } from "@/modules/identity";
import { getAdminPageContext } from "@/app/admin/_lib/context";
import { getRequestLocale } from "@/i18n/resolve";
import { t, type MessageKey } from "@/i18n/t";

const LINKS: Array<{ href: string; labelKey: MessageKey }> = [
  { href: "/admin/gaming/areas", labelKey: "nav.areas" },
  { href: "/admin/gaming/devices", labelKey: "nav.devices" },
  { href: "/admin/gaming/pricing", labelKey: "nav.pricing" },
];

export async function GamingNav({ current }: { current: string }) {
  const locale = await getRequestLocale();
  const { organization } = await getAdminPageContext();
  const permissions = organization?.actor.permissions ?? [];
  const canMaster = permissions.includes(PERMISSIONS.gamingMasterRead);
  if (!canMaster) return null;

  return (
    <nav className="subnav" aria-label={t(locale, "nav.management")}>
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={link.href === current ? "active" : undefined}>
          {t(locale, link.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
