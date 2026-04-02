import { getDB } from "@/lib/db";
import { getStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats — Public cumulative stats.
 * No auth required. Cached 5 minutes via Cache-Control.
 */
export async function GET() {
  const db = getDB();
  const stats = await getStats(db);

  return Response.json(stats, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
