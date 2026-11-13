/**
 * Blocking FOUC bootstrap. Reads `data-ui-theme` set by SSR (HttpOnly cookie
 * is not visible to JS). Resolves `system` via prefers-color-scheme.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){
  try {
    var root = document.documentElement;
    var pref = root.getAttribute("data-ui-theme") || "light";
    var resolved = pref === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : (pref === "dark" ? "dark" : "light");
    root.setAttribute("data-color-scheme", resolved);
    root.style.colorScheme = resolved;
  } catch (e) {}
})();`;
