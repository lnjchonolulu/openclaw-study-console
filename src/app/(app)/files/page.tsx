import { FilesClient } from "@/components/files-client";
import { requireUser } from "@/lib/auth";
import { listWorkspaceFolder } from "@/lib/files";

export default async function FilesPage() {
  const user = await requireUser();
  const initialView = await listWorkspaceFolder(null, user.id);

  return <FilesClient initialView={initialView} />;
}
