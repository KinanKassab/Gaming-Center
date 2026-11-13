"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SignOutButton } from "@/app/admin/_components/controls";
import { LanguageSwitcher } from "@/app/admin/_components/language-switcher";
import { ThemeSwitcher } from "@/app/_components/theme-switcher";
import { localeDir } from "@/i18n/locales";
import { useLocale, useT } from "@/i18n/provider";
import { SHELL_COMPACT_MAX_PX } from "@/ui/shell-layout";
import {
  IconClose,
  IconDashboard,
  IconFloor,
  IconMenu,
  IconMore,
  IconPeople,
  IconReports,
} from "@/app/_components/icons";

export type AdminNavLink = {
  href: string;
  label: string;
  group: "primary" | "management" | "tools";
};

const BOTTOM = [
  { href: "/admin", labelKey: "nav.home" as const, icon: IconDashboard, match: (path: string) => path === "/admin" },
  { href: "/admin/gaming/floor", labelKey: "nav.floorShort" as const, icon: IconFloor, match: (path: string) => path.startsWith("/admin/gaming/floor") },
  { href: "/admin/reports", labelKey: "nav.reports" as const, icon: IconReports, match: (path: string) => path.startsWith("/admin/reports") },
  { href: "/admin/customers", labelKey: "nav.customers" as const, icon: IconPeople, match: (path: string) => path.startsWith("/admin/customers") },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell(props: {
  viewerName: string;
  organizationName: string | null;
  links: AdminNavLink[];
  children: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const dir = localeDir(locale);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const primary = props.links.filter((link) => link.group === "primary");
  const management = props.links.filter((link) => link.group === "management");
  const tools = props.links.filter((link) => link.group === "tools");
  const visibleBottom = BOTTOM.filter((item) =>
    item.href === "/admin" ? true : props.links.some((link) => link.href === item.href),
  );

  function openMenu(from: HTMLElement | null) {
    restoreFocusRef.current = from;
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
    restoreFocusRef.current?.focus();
  }

  useEffect(() => {
    function onResize() {
      if (window.matchMedia(`(min-width: ${SHELL_COMPACT_MAX_PX + 1}px)`).matches) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        restoreFocusRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="app-shell" data-dir={dir} data-nav-open={menuOpen ? "true" : "false"}>
      <a className="skip-link" href="#main-content">
        {t("ui.skipToContent")}
      </a>
      {menuOpen ? (
        <button type="button" className="drawer-backdrop" aria-label={t("common.closeMenu")} onClick={closeMenu} />
      ) : null}
      <aside
        className={`app-sidebar${menuOpen ? " open" : ""}`}
        id="app-sidebar"
        {...(menuOpen
          ? { role: "dialog" as const, "aria-modal": true as const, "aria-label": t("common.primaryNav") }
          : {})}
      >
        <div className="app-sidebar-brand">
          <Link className="app-brand" href="/admin" onClick={closeMenu}>
            {t("brandShort")}
          </Link>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn menu-toggle"
            aria-label={t("common.closeMenu")}
            onClick={closeMenu}
          >
            <IconClose />
          </button>
        </div>
        <NavGroup title={t("nav.operate")} links={primary} pathname={pathname} onNavigate={closeMenu} />
        {management.length > 0 ? (
          <NavGroup title={t("nav.management")} links={management} pathname={pathname} onNavigate={closeMenu} />
        ) : null}
        {tools.length > 0 ? (
          <NavGroup title={t("nav.workspace")} links={tools} pathname={pathname} onNavigate={closeMenu} />
        ) : null}
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="icon-btn menu-toggle"
            aria-label={t("common.openMenu")}
            aria-controls="app-sidebar"
            aria-expanded={menuOpen}
            onClick={(event) => openMenu(event.currentTarget)}
          >
            <IconMenu />
          </button>
          <div className="app-topbar-meta">
            <span>
              {props.viewerName}
              {props.organizationName ? ` · ${props.organizationName}` : ` · ${t("common.chooseCenter")}`}
            </span>
          </div>
          <div className="app-topbar-prefs app-topbar-prefs-desktop">
            <LanguageSwitcher variant="compact" />
            <ThemeSwitcher variant="compact" />
            <SignOutButton />
          </div>
          <div className="app-topbar-prefs app-topbar-prefs-compact">
            <LanguageSwitcher variant="icon" />
            <ThemeSwitcher variant="icon" />
            <SignOutButton variant="icon" />
          </div>
        </header>
        <div className="app-workspace">
          <main id="main-content">{props.children}</main>
        </div>
        {visibleBottom.length > 0 ? (
          <nav className="app-bottom-nav" aria-label={t("common.primaryNav")}>
            {visibleBottom.slice(0, 4).map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={item.match(pathname) ? "active" : ""}
                >
                  <Icon />
                  {t(item.labelKey)}
                </Link>
              );
            })}
            <button
              type="button"
              aria-label={t("common.more")}
              aria-controls="app-sidebar"
              aria-expanded={menuOpen}
              onClick={(event) => openMenu(event.currentTarget)}
            >
              <IconMore />
              {t("common.more")}
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function NavGroup(props: {
  title: string;
  links: AdminNavLink[];
  pathname: string;
  onNavigate: () => void;
}) {
  if (props.links.length === 0) return null;
  return (
    <>
      <div className="app-nav-label">{props.title}</div>
      {props.links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={isActive(props.pathname, link.href) ? "active" : ""}
          {...(isActive(props.pathname, link.href) ? { "aria-current": "page" as const } : {})}
          onClick={props.onNavigate}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
