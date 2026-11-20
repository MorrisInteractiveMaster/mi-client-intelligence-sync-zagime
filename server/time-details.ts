import type { DocumentReference } from "firebase-admin/firestore";
import { safeId } from "./contracts";

export interface TimeEntryDetails {
  personId?: string;
  consultantName?: string;
  notes?: string;
}

export interface StoredTimeDetails extends TimeEntryDetails {
  provider: "quickbooks-time";
  sourceRevision: string;
  sourceModifiedAt: string;
  observedAt: string;
  retrievedVia: "scoped-sync" | "exact-id-lookup";
}

export const timeDetailsRef = (source: DocumentReference, sourceRevision: string) =>
  source.collection("privateDetails").doc(safeId(sourceRevision));

export const timePersonId = (value: unknown): string | undefined =>
  (typeof value === "string" || Number.isSafeInteger(value)) && /^[1-9][0-9]{0,19}$/.test(String(value))
    ? String(value) : undefined;

export const timeNotes = (value: unknown): string | undefined =>
  typeof value === "string" && value.length <= 4000 && value.trim() && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)
    ? value : undefined;

export const timeName = (value: unknown): string | undefined =>
  typeof value === "string" && value.length <= 200 && value.trim() && !/[\u0000-\u001F]/.test(value)
    ? value.trim() : undefined;

export function readTimeDetails(value: unknown, sourceRevision: string, sourceModifiedAt: unknown): TimeEntryDetails | undefined {
  if (!value || typeof value !== "object" || typeof sourceModifiedAt !== "string") return undefined;
  const row = value as Partial<StoredTimeDetails>;
  if (row.provider !== "quickbooks-time" || row.sourceRevision !== sourceRevision || row.sourceModifiedAt !== sourceModifiedAt) return undefined;
  if ((row.retrievedVia !== "scoped-sync" && row.retrievedVia !== "exact-id-lookup") ||
      typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) return undefined;
  const personId = timePersonId(row.personId);
  const consultantName = personId ? timeName(row.consultantName) : undefined;
  const notes = timeNotes(row.notes);
  return {
    ...(personId && { personId }),
    ...(consultantName && { consultantName }),
    ...(notes && { notes }),
  };
}
