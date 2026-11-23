export const ZAGIME_CLIENT_DISPLAY_NAME = "Zagime Anishinabek First Nation";

export function isZagimeClient(id: string) {
  return id === "zagime-production" || id === "zagime";
}

export function clientDisplayName(tenant: { id: string; name: string }, override?: string) {
  return isZagimeClient(tenant.id) ? ZAGIME_CLIENT_DISPLAY_NAME : override || tenant.name;
}
