import type { TenantRecord, TenantStore } from "./contracts";
/** Test adapter only. Never import into the frontend or use as cloud persistence. */
export class MemoryTenantStore implements TenantStore {
  private records: Map<string, TenantRecord>;
  private queue: Promise<unknown> = Promise.resolve();
  writes = 0;
  constructor(records: Record<string, TenantRecord>) {
    this.records = new Map(Object.entries(structuredClone(records)));
  }
  transaction<T>(
    tenantId: string,
    work: (record: TenantRecord) => T | Promise<T>,
  ): Promise<T> {
    const task = this.queue.then(async () => {
      const previous = this.records.get(tenantId);
      if (!previous) throw Error("Forbidden");
      const draft = structuredClone(previous);
      const result = await work(draft);
      if (JSON.stringify(draft) !== JSON.stringify(previous)) {
        this.records.set(tenantId, draft);
        this.writes++;
      }
      return structuredClone(result);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  snapshot(tenantId: string) {
    return structuredClone(this.records.get(tenantId)!);
  }
}
