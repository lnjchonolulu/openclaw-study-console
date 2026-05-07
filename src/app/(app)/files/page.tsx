import { FilesClient } from "@/components/files-client";
import { requireUser } from "@/lib/auth";
import { listWorkspaceFolder } from "@/lib/files";

export default async function FilesPage() {
  await requireUser();
  const initialView = await listWorkspaceFolder(null);

  return <FilesClient initialView={initialView} />;
}
