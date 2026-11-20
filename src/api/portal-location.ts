import { useSyncExternalStore } from "react";
import { parsePlatformPath, routeHref, routeParameters } from "./platform-routes";

const changed = "mi-portal-location";
const current = () => window.location.pathname + window.location.search + window.location.hash;
const subscribe = (listener: () => void) => {
  window.addEventListener(changed, listener);
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
  };
};

export const validMonth = (value: string | null): value is string =>
  value !== null && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);

type Fields = Record<string, string | null>;
export function portalHref(fields: Fields) {
  return routeHref(new URL(window.location.href), fields);
}

export function portalNavigate(fields: Fields, replace = false, overlay?: string) {
  navigatePlatform(portalHref(fields), replace, overlay);
}

export function navigatePlatform(href: string, replace = false, overlay?: string) {
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return;
  if (href === current()) return;
  if (replace) window.history.replaceState(history.state, "", href);
  else window.history.pushState({ miPortalOverlay: overlay }, "", href);
  window.dispatchEvent(new Event(changed));
}

export function closePortalOverlay(key: string) {
  if (history.state?.miPortalOverlay === key) history.back();
  else portalNavigate({ [key]: null }, true);
}

export function usePortalLocation() {
  return routeParameters(new URL(useSyncExternalStore(subscribe, current, () => "/"), "https://platform.invalid"));
}

export function usePlatformRoute() {
  const url = new URL(useSyncExternalStore(subscribe, current, () => "/"), "https://platform.invalid");
  return url.hash.startsWith("#/") ? undefined : parsePlatformPath(url.pathname);
}

export function periodHref(path: string, month: string, fields?: Record<string, string>) {
  return path + "?" + new URLSearchParams({ month, ...fields });
}

export function useReportingMonth(fallback: string) {
  const month = usePortalLocation().get("month");
  return validMonth(month) ? month : fallback;
}
