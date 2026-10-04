// useIsLinux — reads the `data-platform` attribute SettingsContext and
// LaunchSplashWindow stamp on <html> before first paint.
//
// Deliberately not `useSettings().isLinuxHost`: that hook throws outside a
// SettingsProvider, while the decorative backdrop components are rendered in
// isolated tests and must stay provider-free. The attribute is set
// synchronously at startup, so a one-time read (mirroring the
// prefers-reduced-motion `useMemo(() => matchMedia(…), [])` pattern) is
// enough; an OS/platform change is not expected mid-session.
import { useMemo } from "react";

export function useIsLinux(): boolean {
  return useMemo(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.platform === "linux",
    []
  );
}

export default useIsLinux;
