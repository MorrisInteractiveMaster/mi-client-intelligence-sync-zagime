export interface PortalSettings {
  clientLabel: string;
  presentationTitle: string;
  ownerPublishes: boolean;
}

export const defaultPortalSettings: PortalSettings = { clientLabel: "", presentationTitle: "", ownerPublishes: false };

export function portalSettings(value: unknown): PortalSettings {
  if (value === undefined) return defaultPortalSettings;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(key => !Object.hasOwn(defaultPortalSettings, key))) throw Error("Invalid portal settings");
  const { clientLabel, presentationTitle, ownerPublishes } = value as PortalSettings;
  if (typeof clientLabel !== "string" || clientLabel.length > 95 ||
    typeof presentationTitle !== "string" || presentationTitle.length > 100 ||
    /[\u0000-\u001f]/.test(clientLabel + presentationTitle) ||
    typeof ownerPublishes !== "boolean") throw Error("Invalid portal settings");
  return { clientLabel: clientLabel.trim(), presentationTitle: presentationTitle.trim(), ownerPublishes };
}

export interface PlatformControl {
  revision: number;
  settings: PortalSettings;
}
