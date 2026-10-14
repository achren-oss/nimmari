import { db } from "@/db";

let pending: Promise<unknown> = Promise.resolve();
/** Serialize local writers; the database write lock also protects across processes. */
export function writeTransaction<T>(work: Parameters<typeof db.transaction<T>>[0]): Promise<T> {
  const result = pending.then(async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction(work); }
      catch (error) {
        const message = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : "";
        if (attempt >= 7 || !/SQLITE_BUSY|database is locked/i.test(message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(25 * 2 ** attempt, 1000)));
      }
    }
  });
  pending = result.catch(() => undefined);
  return result;
}
