import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12l5 5L20 7" />
    </Svg>
  );
}

export function IconDashboard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="8" rx="1.2" />
      <rect x="13" y="3.5" width="7.5" height="17" rx="1.2" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="1.2" />
    </Svg>
  );
}

export function IconFloor(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function IconSessions(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </Svg>
  );
}

export function IconPeople(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M4 19a5 5 0 0 1 10 0M16 8a3 3 0 1 1 0 6M20 19a4.5 4.5 0 0 0-3-4.2" />
    </Svg>
  );
}

export function IconReports(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 19V9M10 19V5M15 19v-7M20 19V8" />
    </Svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16.5 16.5L21 21" />
    </Svg>
  );
}

export function IconBack(props: IconProps) {
  return (
    <Svg {...props} className={`icon-directional ${props.className ?? ""}`.trim()}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconSignOut(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 6H6v12h4M10 12h8M15 9l3 3-3 3" />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 14.5A7 7 0 1 1 9.5 7 5.5 5.5 0 0 0 17 14.5z" />
    </Svg>
  );
}

export function IconSystem(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </Svg>
  );
}
