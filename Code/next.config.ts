import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { securityHeadersList } from "./src/core/http-security";

/** Windows: `cd code` vs `cd Code` duplicates Next into two webpack modules. */
const APP_ROOT = fs.realpathSync.native(path.resolve(__dirname));
if (process.cwd() !== APP_ROOT) process.chdir(APP_ROOT);

function replaceAllCaseInsensitive(input: string, needle: string, replacement: string): string {
  if (!needle) return input;
  const needleLower = needle.toLowerCase();
  let result = input;
  let from = 0;
  while (from <= result.length) {
    const index = result.toLowerCase().indexOf(needleLower, from);
    if (index === -1) break;
    result = result.slice(0, index) + replacement + result.slice(index + needle.length);
    from = index + replacement.length;
  }
  return result;
}

/** Raw paths and the URL-encoded loader queries Next puts them in (`E%3A%5C...%5Ccode`). */
function foldPathToAppRoot(filePath: string): string {
  const forward = APP_ROOT.replaceAll("\\", "/");
  let folded = replaceAllCaseInsensitive(filePath, APP_ROOT, APP_ROOT);
  folded = replaceAllCaseInsensitive(folded, forward, forward);
  folded = replaceAllCaseInsensitive(folded, encodeURIComponent(APP_ROOT), encodeURIComponent(APP_ROOT));
  folded = replaceAllCaseInsensitive(folded, encodeURIComponent(forward), encodeURIComponent(forward));
  return folded;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["postgres"],
  webpack(config) {
    config.context = APP_ROOT;
    config.plugins = config.plugins ?? [];
    config.plugins.push({
      apply(compiler: { hooks: { normalModuleFactory: { tap: (name: string, fn: (factory: unknown) => void) => void } } }) {
        compiler.hooks.normalModuleFactory.tap("FoldWindowsAppRootCasing", (factory: unknown) => {
          const nmf = factory as {
            hooks: { beforeResolve: { tap: (name: string, fn: (data: { context?: string; request?: string }) => void) => void } };
          };
          nmf.hooks.beforeResolve.tap("FoldWindowsAppRootCasing", (data) => {
            if (typeof data.context === "string") data.context = foldPathToAppRoot(data.context);
            if (typeof data.request === "string") data.request = foldPathToAppRoot(data.request);
          });
        });
      },
    });
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeadersList(),
      },
    ];
  },
};

export default nextConfig;
