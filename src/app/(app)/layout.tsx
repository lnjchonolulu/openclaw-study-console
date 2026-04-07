import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  return (
    <AppShell
      user={{
        displayName: user.displayName,
        username: user.username,
        teamName: user.team?.name ?? null,
      }}
    >
      {children}
    </AppShell>
  );
}
