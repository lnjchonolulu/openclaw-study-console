import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleAuthUrl } from "@/lib/google-integration";

const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

function shouldUseSecureCookie() {
  const appBaseUrl = process.env.APP_BASE_URL?.trim();

  if (appBaseUrl) {
    return appBaseUrl.startsWith("https://");
  }

  return process.env.NODE_ENV === "production";
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.APP_BASE_URL ?? "http://localhost:3000"));
  }

  const state = randomBytes(32).toString("hex");
  const response = NextResponse.redirect(googleAuthUrl(state));

  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
  });

  return response;
}
