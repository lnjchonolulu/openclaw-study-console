import { storeDailyTranscriptWebhook } from "@/lib/daily-transcripts";

export async function POST(request: Request) {
  const webhookToken = process.env.DAILY_WEBHOOK_TOKEN?.trim();

  if (webhookToken) {
    const url = new URL(request.url);
    const providedToken =
      url.searchParams.get("token") ?? request.headers.get("x-cyworld-webhook-token");

    if (providedToken !== webhookToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = (await request.json().catch(() => null)) as unknown;

  if (!body) {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  try {
    const result = await storeDailyTranscriptWebhook(body);

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Daily transcript webhook failed.",
      },
      { status: 500 },
    );
  }
}
