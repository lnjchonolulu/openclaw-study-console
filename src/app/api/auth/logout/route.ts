import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { appUrl } from "@/lib/url";

export async function POST(request: Request) {
  await destroySession();
  return NextResponse.redirect(appUrl("/login", request.url));
}
