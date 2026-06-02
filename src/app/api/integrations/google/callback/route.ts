import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveGoogleAuthCode } from "@/lib/google-integration";

const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

function appUrl(path: string, requestUrl: string) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || requestUrl;

  return new URL(path, baseUrl);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.redirect(appUrl("/login", request.url));
  }

  if (user.role !== "ADMIN") {
    return NextResponse.redirect(appUrl("/chat", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(appUrl("/admin?google=error", request.url));
  }

  try {
    await saveGoogleAuthCode({
      code,
      connectedById: user.id,
    });
  } catch (error) {
    console.error("[google-oauth] callback failed", error);
    return NextResponse.redirect(appUrl("/admin?google=error", request.url));
  }

  const response = NextResponse.redirect(appUrl("/admin?google=connected", request.url));
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
    expires: new Date(0),
    path: "/",
  });

  return response;
}
