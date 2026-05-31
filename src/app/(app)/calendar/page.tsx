import { CalendarClient } from "@/components/calendar-client";
import { requireUser } from "@/lib/auth";
import { listCalendarMonth } from "@/lib/calendar";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const initialView = await listCalendarMonth(user.id, params.month);

  if (!initialView) {
    return null;
  }

  return <CalendarClient initialView={initialView} />;
}
