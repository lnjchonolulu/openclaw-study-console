export function appUrl(path: string, requestUrl: string) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || new URL(requestUrl).origin;
  return new URL(path, baseUrl);
}
