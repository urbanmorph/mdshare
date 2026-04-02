// Custom worker entry point that exports both the OpenNext handler,
// Durable Object class, and scheduled cron handler.

// @ts-ignore - .open-next/worker.js is generated at build time
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,

  // Daily cron: clean up expired documents
  async scheduled(event: ScheduledEvent, env: Record<string, unknown>, ctx: ExecutionContext) {
    const db = env.DB as D1Database;
    if (!db) return;

    const result = await db
      .prepare("DELETE FROM documents WHERE expires_at IS NOT NULL AND expires_at < datetime('now')")
      .run();

    console.log(`Cron cleanup: deleted ${result.meta?.changes || 0} expired documents`);
  },
};

// Export our Durable Object class
export { DocumentWebSocket } from "./worker/document-ws";
