import { ZAGIME_CLIENT_DISPLAY_NAME } from "./client-identity";

/** Approved assets only. Null deliberately renders an elegant text placeholder. */
export const branding = {
  clientName: ZAGIME_CLIENT_DISPLAY_NAME,
  partnerName: "Morris Interactive",
  clientLogo: "branding/zagime/zagime.jpeg" as string | null,
  partnerLogo: "branding/morris/morris-wordmark.png" as string | null,
  heroImage: null as string | null,
};
export const brandAsset = (path: string) =>
  `${(import.meta.env?.BASE_URL ?? "./")}${path.replace(/^\//, "")}`;
