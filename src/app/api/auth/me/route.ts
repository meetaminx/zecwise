import { handle } from "@/lib/api";
import { getSessionUser } from "@/lib/auth/session";
import { featureStatus } from "@/lib/config";

export const GET = handle(async () => {
  if (!featureStatus().auth) return Response.json({ user: null, authConfigured: false });
  const user = await getSessionUser();
  return Response.json({ user: user ? { email: user.email, role: user.role } : null, authConfigured: true });
});
