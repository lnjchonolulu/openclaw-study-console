import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    confirmPassword?: string;
    currentPassword?: string;
    nextPassword?: string;
  };

  const currentPassword = body.currentPassword?.trim() ?? "";
  const nextPassword = body.nextPassword?.trim() ?? "";
  const confirmPassword = body.confirmPassword?.trim() ?? "";

  if (!currentPassword || !nextPassword || !confirmPassword) {
    return NextResponse.json(
      { error: "All password fields are required." },
      { status: 400 },
    );
  }

  if (nextPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters." },
      { status: 400 },
    );
  }

  if (nextPassword !== confirmPassword) {
    return NextResponse.json(
      { error: "New password and confirmation do not match." },
      { status: 400 },
    );
  }

  const isValid = await verifyPassword(currentPassword, user.passwordHash);

  if (!isValid) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 },
    );
  }

  const nextPasswordHash = await hashPassword(nextPassword);

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash: nextPasswordHash,
    },
  });

  return NextResponse.json({ ok: true });
}
