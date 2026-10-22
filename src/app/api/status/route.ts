import { connection } from "next/server";
import { featureStatus } from "@/lib/config";

/** Which features are configured on this server. Exposes booleans only, never key values. */
export async function GET() {
  await connection();
  return Response.json(featureStatus(), { headers: { "cache-control": "no-store" } });
}
