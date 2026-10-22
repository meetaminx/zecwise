import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: sends visitors without a session cookie to the sign-in
 * page. Real authorization happens in every admin API route (requireRole), which
 * verifies the token and re-reads the user's role from the database.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && !request.cookies.has("zw_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
