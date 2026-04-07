import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = formData.get("username");
  const password = formData.get("password");

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.redirect(new URL("/login?error=invalid", request.url));
  }

  const user = await prisma.user.findUnique({
    where: {
      username,
    },
  });

  if (!user) {
    return NextResponse.redirect(new URL("/login?error=credentials", request.url));
  }

  const isValid = await verifyPassword(password, user.passwordHash);

  if (!isValid) {
    return NextResponse.redirect(new URL("/login?error=credentials", request.url));
  }

  await createSession(user.id);

  return NextResponse.redirect(new URL("/chat", request.url));
}
