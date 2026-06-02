import { redirect } from "next/navigation";
import { AdminSettingsClient } from "@/components/admin-settings-client";
import { requireUser } from "@/lib/auth";
import { getGoogleIntegrationStatus } from "@/lib/google-integration";

export default async function AdminPage() {
  const user = await requireUser();

  if (user.role !== "ADMIN") {
    redirect("/chat");
  }

  const googleIntegration = await getGoogleIntegrationStatus();

  return <AdminSettingsClient initialGoogleIntegration={googleIntegration} />;
}
