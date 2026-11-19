import { useSyncExternalStore } from "react";

const changed = "mi-portal-location";
const current = () => window.location.search;
const subscribe = (listener: () => void) => {
  window.addEventListener(changed, listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("popstate", listener);
  };
};

export const validMonth = (value: string | null): value is string =>
  value !== null && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);

type Fields = Record<string, string | null>;
export function portalHref(fields: Fields) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(fields)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return url.pathname + url.search + url.hash;
}

export function portalNavigate(fields: Fields, replace = false, overlay?: string) {
  const href = portalHref(fields);
  if (href === window.location.pathname + window.location.search + window.location.hash) return;
  if (replace) window.history.replaceState(history.state, "", href);
  else window.history.pushState({ miPortalOverlay: overlay }, "", href);
  window.dispatchEvent(new Event(changed));
}

export function closePortalOverlay(key: string) {
  if (history.state?.miPortalOverlay === key) history.back();
  else portalNavigate({ [key]: null }, true);
}

export function usePortalLocation() {
  return new URLSearchParams(useSyncExternalStore(subscribe, current, () => ""));
}

export function useReportingMonth(fallback: string) {
  const month = usePortalLocation().get("month");
  return validMonth(month) ? month : fallback;
}
