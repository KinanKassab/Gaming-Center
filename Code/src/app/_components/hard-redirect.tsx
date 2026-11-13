"use client";

import { useEffect } from "react";

/**
 * Full document navigation. Do not use `next/navigation` `redirect()` under
 * nested admin layouts — client transitions unmount OuterLayoutRouter.
 */
export function HardRedirect(props: { href: string }) {
  useEffect(() => {
    window.location.replace(props.href);
  }, [props.href]);
  return null;
}
