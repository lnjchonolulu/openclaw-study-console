export type GeneratedImage = {
  buffer: Buffer;
  mimeType: string;
};

type ImageSize = "auto" | "1024x1024" | "1024x1536" | "1536x1024";

function getImageModel() {
  return process.env.CYWORLD_IMAGE_MODEL?.trim() || "gpt-image-1.5";
}

function getOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  return apiKey;
}

function normalizeSize(value: unknown): ImageSize {
  return value === "1024x1024" || value === "1024x1536" || value === "1536x1024"
    ? value
    : "auto";
}

async function parseImageResponse(response: Response): Promise<GeneratedImage> {
  const payload = (await response.json()) as {
    data?: Array<{
      b64_json?: string;
    }>;
    error?: unknown;
  };

  if (!response.ok) {
    const message =
      payload.error && typeof payload.error === "object"
        ? JSON.stringify(payload.error)
        : typeof payload.error === "string"
          ? payload.error
          : `OpenAI Images API returned ${response.status}.`;
    throw new Error(message);
  }

  const b64 = payload.data?.[0]?.b64_json;

  if (!b64) {
    throw new Error("OpenAI Images API returned no image data.");
  }

  return {
    buffer: Buffer.from(b64, "base64"),
    mimeType: "image/png",
  };
}

export async function generateOpenAiImage({
  prompt,
  size,
}: {
  prompt: string;
  size?: unknown;
}) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getImageModel(),
      prompt,
      size: normalizeSize(size),
    }),
  });

  return parseImageResponse(response);
}

export async function editOpenAiImage({
  image,
  prompt,
  size,
}: {
  image: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  };
  prompt: string;
  size?: unknown;
}) {
  const formData = new FormData();
  formData.set("model", getImageModel());
  formData.set("prompt", prompt);
  formData.set("size", normalizeSize(size));
  formData.set(
    "image",
    new File([new Uint8Array(image.buffer)], image.filename, {
      type: image.mimeType,
    }),
  );

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAiApiKey()}`,
    },
    body: formData,
  });

  return parseImageResponse(response);
}
