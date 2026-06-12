import { type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

export const GOOGLE_SLIDES_SCOPE =
  "https://www.googleapis.com/auth/presentations";
export const GOOGLE_DOCS_SCOPE =
  "https://www.googleapis.com/auth/documents";
export const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";
export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

export type GoogleWorkspaceFileType = "docs" | "sheets" | "slides";

type GoogleTokenJson = {
  access_token?: string;
  expires_in?: number;
  expiry_date?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleAccess = {
  accessToken: string;
  accountEmail: string | null;
};

export type GmailMessageView = {
  body: string;
  cc: string | null;
  date: Date | null;
  from: string | null;
  id: string;
  internalDate: Date | null;
  snippet: string;
  subject: string | null;
  threadId: string;
  to: string | null;
};

type GoogleSlidesTextElement = {
  endIndex?: number;
  startIndex?: number;
  textRun?: {
    content?: string;
  };
};

type GoogleSlidesPageElement = {
  objectId?: string;
  description?: string;
  image?: unknown;
  line?: unknown;
  shape?: {
    shapeType?: string;
    text?: {
      textElements?: GoogleSlidesTextElement[];
    };
  };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{
        text?: {
          textElements?: GoogleSlidesTextElement[];
        };
      }>;
    }>;
  };
  title?: string;
  video?: unknown;
  wordArt?: unknown;
};

type GoogleSlidesPresentation = {
  presentationId?: string;
  revisionId?: string;
  slides?: Array<{
    objectId?: string;
    pageElements?: GoogleSlidesPageElement[];
  }>;
  title?: string;
};

type GoogleDocsStructuralElement = {
  endIndex?: number;
  paragraph?: {
    elements?: Array<{
      endIndex?: number;
      startIndex?: number;
      textRun?: {
        content?: string;
      };
    }>;
  };
  sectionBreak?: unknown;
  startIndex?: number;
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{
        content?: GoogleDocsStructuralElement[];
      }>;
    }>;
  };
  tableOfContents?: {
    content?: GoogleDocsStructuralElement[];
  };
};

type GoogleDocsTab = {
  childTabs?: GoogleDocsTab[];
  documentTab?: {
    body?: {
      content?: GoogleDocsStructuralElement[];
    };
  };
  tabProperties?: {
    index?: number;
    parentTabId?: string;
    tabId?: string;
    title?: string;
  };
};

type GoogleDocument = {
  body?: {
    content?: GoogleDocsStructuralElement[];
  };
  documentId?: string;
  revisionId?: string;
  tabs?: GoogleDocsTab[];
  title?: string;
};

type GoogleDriveFile = {
  createdTime?: string;
  id?: string;
  mimeType?: string;
  modifiedTime?: string;
  name?: string;
  webViewLink?: string;
};

type GoogleDriveComment = {
  author?: {
    displayName?: string;
    me?: boolean;
    photoLink?: string;
  };
  content?: string;
  createdTime?: string;
  deleted?: boolean;
  htmlContent?: string;
  id?: string;
  modifiedTime?: string;
  quotedFileContent?: {
    mimeType?: string;
    value?: string;
  };
  replies?: GoogleDriveReply[];
  resolved?: boolean;
};

type GoogleDriveReply = {
  action?: string;
  author?: {
    displayName?: string;
    me?: boolean;
    photoLink?: string;
  };
  content?: string;
  createdTime?: string;
  deleted?: boolean;
  htmlContent?: string;
  id?: string;
  modifiedTime?: string;
};

type GoogleDocsSuggestionOccurrence = {
  ids: string[];
  kind: string;
  path: string;
};

type GoogleSpreadsheet = {
  properties?: {
    locale?: string;
    timeZone?: string;
    title?: string;
  };
  sheets?: Array<{
    properties?: {
      gridProperties?: {
        columnCount?: number;
        frozenColumnCount?: number;
        frozenRowCount?: number;
        rowCount?: number;
      };
      index?: number;
      sheetId?: number;
      sheetType?: string;
      title?: string;
    };
  }>;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
};

type GoogleValueRange = {
  majorDimension?: string;
  range?: string;
  values?: unknown[][];
};

type GoogleDocsTabSummary = {
  childTabs: GoogleDocsTabSummary[];
  elements: Array<{
    endIndex: number | null;
    startIndex: number | null;
    text: string | null;
    type: string;
  }>;
  index: number | null;
  parentTabId: string | null;
  tabId: string | null;
  title: string | null;
};

function getGoogleRedirectUri() {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();

  if (configured) {
    return configured;
  }

  const baseUrl = process.env.APP_BASE_URL?.trim();

  if (!baseUrl) {
    throw new Error("Missing GOOGLE_REDIRECT_URI or APP_BASE_URL.");
  }

  return `${baseUrl.replace(/\/$/, "")}/api/integrations/google/callback`;
}

function getGoogleClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.");
  }

  return {
    clientId,
    clientSecret,
    redirectUri: getGoogleRedirectUri(),
  };
}

function toTokenJson(value: unknown): GoogleTokenJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as GoogleTokenJson;
}

async function googleJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text
    ? (JSON.parse(text) as T & { error?: unknown; error_description?: string })
    : null;

  if (!response.ok) {
    const error = data?.error;
    const message =
      data?.error_description ||
      (typeof error === "string" ? error : error ? JSON.stringify(error) : response.statusText);
    throw new Error(`Google API request failed: ${message}`);
  }

  return data as T;
}

function hasGoogleScope(scopes: string[], requiredScope: string) {
  return scopes.includes(requiredScope);
}

function extractGoogleSlidesPresentationId(value: string) {
  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  try {
    const url = new URL(cleaned);
    const match = url.pathname.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);

    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // A bare presentation ID is also accepted.
  }

  return /^[a-zA-Z0-9_-]{10,}$/.test(cleaned) ? cleaned : null;
}

function extractGoogleDocsDocumentId(value: string) {
  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  try {
    const url = new URL(cleaned);
    const match = url.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);

    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // A bare document ID is also accepted.
  }

  return /^[a-zA-Z0-9_-]{10,}$/.test(cleaned) ? cleaned : null;
}

function extractGoogleSheetsSpreadsheetId(value: string) {
  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  try {
    const url = new URL(cleaned);
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);

    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // A bare spreadsheet ID is also accepted.
  }

  return /^[a-zA-Z0-9_-]{10,}$/.test(cleaned) ? cleaned : null;
}

function extractGoogleDriveFileId(value: string) {
  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  try {
    const url = new URL(cleaned);
    const match =
      url.pathname.match(
        /\/(?:presentation|document|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/,
      ) ?? url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);

    if (match?.[1]) {
      return match[1];
    }

    const queryId = url.searchParams.get("id");

    if (queryId && /^[a-zA-Z0-9_-]{10,}$/.test(queryId)) {
      return queryId;
    }
  } catch {
    // A bare Drive file ID is also accepted.
  }

  return /^[a-zA-Z0-9_-]{10,}$/.test(cleaned) ? cleaned : null;
}

function googleWorkspaceFileConfig(fileType: GoogleWorkspaceFileType) {
  if (fileType === "slides") {
    return {
      label: "Google Slides",
      mimeType: "application/vnd.google-apps.presentation",
      url: (id: string) => `https://docs.google.com/presentation/d/${id}/edit`,
    };
  }

  if (fileType === "docs") {
    return {
      label: "Google Docs",
      mimeType: "application/vnd.google-apps.document",
      url: (id: string) => `https://docs.google.com/document/d/${id}/edit`,
    };
  }

  return {
    label: "Google Sheets",
    mimeType: "application/vnd.google-apps.spreadsheet",
    url: (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`,
  };
}

function collectGoogleDocsSuggestions(
  value: unknown,
  path = "$",
  occurrences: GoogleDocsSuggestionOccurrence[] = [],
  ids = new Set<string>(),
) {
  if (occurrences.length >= 200 || value === null || value === undefined) {
    return {
      ids,
      occurrences,
    };
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectGoogleDocsSuggestions(entry, `${path}[${index}]`, occurrences, ids);
    });

    return {
      ids,
      occurrences,
    };
  }

  if (typeof value !== "object") {
    return {
      ids,
      occurrences,
    };
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;

    if (/^suggested.+Ids$/.test(key) && Array.isArray(entry)) {
      const suggestionIds = entry.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && Boolean(candidate.trim()),
      );

      suggestionIds.forEach((suggestionId) => ids.add(suggestionId));

      if (suggestionIds.length) {
        occurrences.push({
          ids: suggestionIds,
          kind: key,
          path: nextPath,
        });
      }
    } else if (
      /^suggested.+Changes$/.test(key) &&
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry)
    ) {
      const suggestionIds = Object.keys(entry);

      suggestionIds.forEach((suggestionId) => ids.add(suggestionId));

      if (suggestionIds.length) {
        occurrences.push({
          ids: suggestionIds,
          kind: key,
          path: nextPath,
        });
      }
    }

    collectGoogleDocsSuggestions(entry, nextPath, occurrences, ids);
  }

  return {
    ids,
    occurrences,
  };
}

function textFromElements(elements: GoogleSlidesTextElement[] | undefined) {
  return (elements ?? [])
    .map((element) => element.textRun?.content ?? "")
    .join("")
    .trim();
}

function pageElementType(element: GoogleSlidesPageElement) {
  if (element.shape) {
    return element.shape.shapeType ? `shape:${element.shape.shapeType}` : "shape";
  }

  if (element.table) {
    return "table";
  }

  if (element.image) {
    return "image";
  }

  if (element.video) {
    return "video";
  }

  if (element.line) {
    return "line";
  }

  if (element.wordArt) {
    return "word_art";
  }

  return "page_element";
}

function pageElementText(element: GoogleSlidesPageElement) {
  const shapeText = textFromElements(element.shape?.text?.textElements);

  if (shapeText) {
    return shapeText;
  }

  const tableText = (element.table?.tableRows ?? [])
    .flatMap((row) => row.tableCells ?? [])
    .map((cell) => textFromElements(cell.text?.textElements))
    .filter(Boolean)
    .join("\n");

  return tableText || null;
}

function googleDocsStructuralText(
  elements: GoogleDocsStructuralElement[] | undefined,
): string {
  return (elements ?? [])
    .map((element) => {
      const paragraphText = (element.paragraph?.elements ?? [])
        .map((paragraphElement) => paragraphElement.textRun?.content ?? "")
        .join("");
      const tableText = (element.table?.tableRows ?? [])
        .flatMap((row) => row.tableCells ?? [])
        .map((cell) => googleDocsStructuralText(cell.content))
        .filter(Boolean)
        .join("\n");
      const tableOfContentsText = googleDocsStructuralText(
        element.tableOfContents?.content,
      );

      return paragraphText || tableText || tableOfContentsText;
    })
    .join("")
    .trim();
}

function googleDocsStructuralType(element: GoogleDocsStructuralElement) {
  if (element.paragraph) {
    return "paragraph";
  }

  if (element.table) {
    return "table";
  }

  if (element.tableOfContents) {
    return "table_of_contents";
  }

  if (element.sectionBreak) {
    return "section_break";
  }

  return "structural_element";
}

function summarizeGoogleDocsElements(
  elements: GoogleDocsStructuralElement[] | undefined,
) {
  return (elements ?? []).map((element) => ({
    endIndex: element.endIndex ?? null,
    startIndex: element.startIndex ?? null,
    text: googleDocsStructuralText([element]) || null,
    type: googleDocsStructuralType(element),
  }));
}

function summarizeGoogleDocsTabs(
  tabs: GoogleDocsTab[] | undefined,
): GoogleDocsTabSummary[] {
  return (tabs ?? []).map((tab) => ({
    childTabs: summarizeGoogleDocsTabs(tab.childTabs),
    elements: summarizeGoogleDocsElements(tab.documentTab?.body?.content),
    index: tab.tabProperties?.index ?? null,
    parentTabId: tab.tabProperties?.parentTabId ?? null,
    tabId: tab.tabProperties?.tabId ?? null,
    title: tab.tabProperties?.title ?? null,
  }));
}

const ALLOWED_GOOGLE_SLIDES_REQUESTS = new Set([
  "createImage",
  "createLine",
  "createParagraphBullets",
  "createShape",
  "createSlide",
  "createSheetsChart",
  "createTable",
  "createVideo",
  "deleteObject",
  "deleteParagraphBullets",
  "deleteTableColumn",
  "deleteTableRow",
  "deleteText",
  "duplicateObject",
  "groupObjects",
  "insertTableColumns",
  "insertTableRows",
  "insertText",
  "mergeTableCells",
  "refreshSheetsChart",
  "replaceAllShapesWithImage",
  "replaceAllShapesWithSheetsChart",
  "replaceAllText",
  "replaceImage",
  "rerouteLine",
  "ungroupObjects",
  "unmergeTableCells",
  "updateImageProperties",
  "updateLineCategory",
  "updateLineProperties",
  "updatePageElementAltText",
  "updatePageElementTransform",
  "updatePageElementsZOrder",
  "updatePageProperties",
  "updateParagraphStyle",
  "updateShapeProperties",
  "updateSlideProperties",
  "updateSlidesPosition",
  "updateTableBorderProperties",
  "updateTableCellProperties",
  "updateTableColumnProperties",
  "updateTableRowProperties",
  "updateTextStyle",
  "updateVideoProperties",
]);

function parseGoogleSlidesRequests(value: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      ok: false as const,
      reason: "invalid_requests_json",
    };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50) {
    return {
      ok: false as const,
      reason: "requests_must_be_a_nonempty_array_with_at_most_50_items",
    };
  }

  for (const request of parsed) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return {
        ok: false as const,
        reason: "each_request_must_be_an_object",
      };
    }

    const keys = Object.keys(request);

    if (keys.length !== 1 || !ALLOWED_GOOGLE_SLIDES_REQUESTS.has(keys[0])) {
      return {
        ok: false as const,
        reason: "unsupported_google_slides_request",
        requestType: keys[0] ?? null,
      };
    }
  }

  return {
    ok: true as const,
    requests: parsed as Array<Record<string, unknown>>,
  };
}

const ALLOWED_GOOGLE_DOCS_REQUESTS = new Set([
  "addDocumentTab",
  "createFooter",
  "createFootnote",
  "createHeader",
  "createNamedRange",
  "createParagraphBullets",
  "deleteContentRange",
  "deleteDocumentTab",
  "deleteFooter",
  "deleteHeader",
  "deleteNamedRange",
  "deleteParagraphBullets",
  "deletePositionedObject",
  "deleteTab",
  "insertDate",
  "insertInlineImage",
  "insertInlineSheetsChart",
  "insertPageBreak",
  "insertPerson",
  "insertRichLink",
  "insertSectionBreak",
  "insertTable",
  "insertTableColumn",
  "insertTableRow",
  "insertText",
  "mergeTableCells",
  "pinTableHeaderRows",
  "replaceAllText",
  "replaceImage",
  "replaceNamedRangeContent",
  "unmergeTableCells",
  "updateDocumentStyle",
  "updateDocumentTabProperties",
  "updateNamedStyle",
  "updateParagraphStyle",
  "updateSectionStyle",
  "updateTableCellStyle",
  "updateTableColumnProperties",
  "updateTableRowStyle",
  "updateTextStyle",
]);

const ALLOWED_GOOGLE_SHEETS_REQUESTS = new Set([
  "addBanding",
  "addChart",
  "addConditionalFormatRule",
  "addDataSource",
  "addDimensionGroup",
  "addFilterView",
  "addNamedRange",
  "addProtectedRange",
  "addSheet",
  "addSlicer",
  "addTable",
  "appendCells",
  "appendDimension",
  "autoFill",
  "autoResizeDimensions",
  "cancelDataSourceRefresh",
  "clearBasicFilter",
  "copyPaste",
  "createDeveloperMetadata",
  "cutPaste",
  "deleteBanding",
  "deleteConditionalFormatRule",
  "deleteDataSource",
  "deleteDeveloperMetadata",
  "deleteDimension",
  "deleteDimensionGroup",
  "deleteDuplicates",
  "deleteEmbeddedObject",
  "deleteFilterView",
  "deleteNamedRange",
  "deleteProtectedRange",
  "deleteRange",
  "deleteSheet",
  "deleteTable",
  "duplicateFilterView",
  "duplicateSheet",
  "findReplace",
  "insertDimension",
  "insertRange",
  "mergeCells",
  "moveDimension",
  "pasteData",
  "randomizeRange",
  "refreshDataSource",
  "repeatCell",
  "setBasicFilter",
  "setDataValidation",
  "sortRange",
  "textToColumns",
  "trimWhitespace",
  "unmergeCells",
  "updateBanding",
  "updateBorders",
  "updateCells",
  "updateChartSpec",
  "updateConditionalFormatRule",
  "updateDataSource",
  "updateDeveloperMetadata",
  "updateDimensionGroup",
  "updateDimensionProperties",
  "updateEmbeddedObjectBorder",
  "updateEmbeddedObjectPosition",
  "updateFilterView",
  "updateNamedRange",
  "updateProtectedRange",
  "updateSheetProperties",
  "updateSlicerSpec",
  "updateSpreadsheetProperties",
  "updateTable",
]);

function parseGoogleBatchRequests(
  value: string,
  allowedRequests: Set<string>,
  unsupportedReason: string,
) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      ok: false as const,
      reason: "invalid_requests_json",
    };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50) {
    return {
      ok: false as const,
      reason: "requests_must_be_a_nonempty_array_with_at_most_50_items",
    };
  }

  for (const request of parsed) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return {
        ok: false as const,
        reason: "each_request_must_be_an_object",
      };
    }

    const keys = Object.keys(request);

    if (keys.length !== 1 || !allowedRequests.has(keys[0])) {
      return {
        ok: false as const,
        reason: unsupportedReason,
        requestType: keys[0] ?? null,
      };
    }
  }

  return {
    ok: true as const,
    requests: parsed as Array<Record<string, unknown>>,
  };
}

function parseGoogleDocsRequests(value: string) {
  return parseGoogleBatchRequests(
    value,
    ALLOWED_GOOGLE_DOCS_REQUESTS,
    "unsupported_google_docs_request",
  );
}

function parseGoogleSheetsRequests(value: string) {
  return parseGoogleBatchRequests(
    value,
    ALLOWED_GOOGLE_SHEETS_REQUESTS,
    "unsupported_google_sheets_request",
  );
}

function parseGoogleSheetsRanges(value: string | null | undefined) {
  if (!value?.trim()) {
    return {
      ok: true as const,
      ranges: [] as string[],
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      ok: false as const,
      reason: "invalid_ranges_json",
    };
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length > 20 ||
    parsed.some((range) => typeof range !== "string" || !range.trim())
  ) {
    return {
      ok: false as const,
      reason: "ranges_must_be_a_json_array_with_at_most_20_nonempty_strings",
    };
  }

  return {
    ok: true as const,
    ranges: parsed.map((range) => range.trim()),
  };
}

async function googleSlidesAccessStatus() {
  const status = await getGoogleIntegrationStatus();

  if (!status.connected) {
    return {
      accountEmail: status.accountEmail,
      ok: false as const,
      reason: "google_not_connected",
    };
  }

  if (!hasGoogleScope(status.scopes, GOOGLE_SLIDES_SCOPE)) {
    return {
      accountEmail: status.accountEmail,
      ok: false as const,
      reason: "google_reconnect_required_for_slides",
    };
  }

  const access = await getGoogleAccess();

  if (!access) {
    return {
      accountEmail: status.accountEmail,
      ok: false as const,
      reason: "google_access_token_unavailable",
    };
  }

  return {
    ...access,
    ok: true as const,
  };
}

function googleSlidesSharingGuidance(accountEmail: string | null) {
  return `Share the Google Slides file with ${
    accountEmail ?? "the Google account connected in CyWorld Admin Settings"
  } and grant Editor access, then try again.`;
}

async function googleWorkspaceAccessStatus({
  reconnectReason,
  requiredScope,
}: {
  reconnectReason: string;
  requiredScope: string;
}) {
  const status = await getGoogleIntegrationStatus();

  if (!status.connected) {
    return {
      accountEmail: status.accountEmail,
      ok: false as const,
      reason: "google_not_connected",
    };
  }

  if (!hasGoogleScope(status.scopes, requiredScope)) {
    return {
      accountEmail: status.accountEmail,
      ok: false as const,
      reason: reconnectReason,
    };
  }

  const access = await getGoogleAccess();

  if (!access) {
    return {
      accountEmail: status.accountEmail,
      ok: false as const,
      reason: "google_access_token_unavailable",
    };
  }

  return {
    ...access,
    ok: true as const,
  };
}

function googleWorkspaceSharingGuidance({
  accountEmail,
  fileType,
}: {
  accountEmail: string | null;
  fileType: string;
}) {
  return `Share the ${fileType} file with ${
    accountEmail ?? "the Google account connected in CyWorld Admin Settings"
  } and grant Editor access, then try again.`;
}

function googleDriveFileGuidance(accountEmail: string | null) {
  return `Google Drive review actions use drive.file access. The file must either be created by CyWorld or explicitly opened/authorized for ${
    accountEmail ?? "the Google account connected in CyWorld Admin Settings"
  }.`;
}

export function googleAuthUrl(state: string) {
  const { clientId, redirectUri } = getGoogleClientConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", state);

  return url.toString();
}

async function exchangeGoogleCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  return googleJson<GoogleTokenJson>("https://oauth2.googleapis.com/token", {
    body,
    method: "POST",
  });
}

async function refreshGoogleToken(tokens: GoogleTokenJson) {
  if (!tokens.refresh_token) {
    throw new Error("Google refresh token is missing. Reconnect Google.");
  }

  const { clientId, clientSecret } = getGoogleClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });

  const refreshed = await googleJson<GoogleTokenJson>(
    "https://oauth2.googleapis.com/token",
    {
      body,
      method: "POST",
    },
  );

  return {
    ...tokens,
    ...refreshed,
    expiry_date: refreshed.expires_in
      ? Date.now() + refreshed.expires_in * 1000
      : refreshed.expiry_date,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
  } satisfies GoogleTokenJson;
}

async function fetchGoogleUserEmail(accessToken: string) {
  const profile = await googleJson<{ email?: string }>(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
  );

  return profile.email ?? null;
}

export async function saveGoogleAuthCode({
  code,
  connectedById,
}: {
  code: string;
  connectedById: string;
}) {
  const tokens = await exchangeGoogleCode(code);
  const existing = await prisma.externalIntegration.findUnique({
    where: {
      provider: "GOOGLE",
    },
    select: {
      tokenJson: true,
    },
  });
  const currentTokens = toTokenJson(existing?.tokenJson);
  const nextTokens = {
    ...currentTokens,
    ...tokens,
    expiry_date: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : tokens.expiry_date,
    refresh_token: tokens.refresh_token ?? currentTokens.refresh_token,
  };
  const returnedScopes =
    nextTokens.scope
      ?.split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean) ?? [];
  const grantedScopes = returnedScopes.length ? returnedScopes : GOOGLE_SCOPES;
  const accountEmail = nextTokens.access_token
    ? await fetchGoogleUserEmail(nextTokens.access_token)
    : null;

  await prisma.externalIntegration.upsert({
    where: {
      provider: "GOOGLE",
    },
    update: {
      accountEmail,
      connectedAt: new Date(),
      connectedById,
      scopes: grantedScopes,
      tokenJson: nextTokens as Prisma.InputJsonValue,
    },
    create: {
      accountEmail,
      connectedById,
      provider: "GOOGLE",
      scopes: grantedScopes,
      tokenJson: nextTokens as Prisma.InputJsonValue,
    },
  });
}

export async function getGoogleIntegrationStatus() {
  const integration = await prisma.externalIntegration.findUnique({
    where: {
      provider: "GOOGLE",
    },
    select: {
      accountEmail: true,
      connectedAt: true,
      scopes: true,
    },
  });

  return {
    accountEmail: integration?.accountEmail ?? null,
    connected: Boolean(integration),
    connectedAt: integration?.connectedAt.toISOString() ?? null,
    scopes: integration?.scopes ?? [],
  };
}

export async function disconnectGoogleIntegration() {
  await prisma.externalIntegration.deleteMany({
    where: {
      provider: "GOOGLE",
    },
  });
}

async function getGoogleAccess(): Promise<GoogleAccess | null> {
  const integration = await prisma.externalIntegration.findUnique({
    where: {
      provider: "GOOGLE",
    },
  });

  if (!integration) {
    return null;
  }

  let tokens = toTokenJson(integration.tokenJson);

  if (
    !tokens.access_token ||
    !tokens.expiry_date ||
    tokens.expiry_date < Date.now() + 60_000
  ) {
    tokens = await refreshGoogleToken(tokens);
    await prisma.externalIntegration.update({
      where: {
        provider: "GOOGLE",
      },
      data: {
        tokenJson: tokens as Prisma.InputJsonValue,
      },
    });
  }

  if (!tokens.access_token) {
    return null;
  }

  return {
    accessToken: tokens.access_token,
    accountEmail: integration.accountEmail,
  };
}

async function googleDriveFileAccessStatus() {
  return googleWorkspaceAccessStatus({
    reconnectReason: "google_reconnect_required_for_drive_file",
    requiredScope: GOOGLE_DRIVE_FILE_SCOPE,
  });
}

async function getGoogleDriveFileMetadata({
  accessToken,
  fileId,
}: {
  accessToken: string;
  fileId: string;
}) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
  );
  url.searchParams.set(
    "fields",
    "id,name,mimeType,webViewLink,createdTime,modifiedTime",
  );

  return googleJson<GoogleDriveFile>(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    method: "GET",
  });
}

export async function createGoogleWorkspaceFile({
  fileType,
  title,
}: {
  fileType: GoogleWorkspaceFileType;
  title: string;
}) {
  const cleanedTitle = title.trim();

  if (!cleanedTitle) {
    return {
      ok: false as const,
      reason: "missing_google_workspace_file_title",
    };
  }

  const access = await googleDriveFileAccessStatus();

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_drive_file"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants drive.file access."
          : googleDriveFileGuidance(access.accountEmail),
    };
  }

  const config = googleWorkspaceFileConfig(fileType);

  try {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set(
      "fields",
      "id,name,mimeType,webViewLink,createdTime,modifiedTime",
    );
    const result = await googleJson<GoogleDriveFile>(url.toString(), {
      body: JSON.stringify({
        mimeType: config.mimeType,
        name: cleanedTitle,
      }),
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const fileId = result.id;

    if (!fileId) {
      return {
        accountEmail: access.accountEmail,
        ok: false as const,
        reason: "google_workspace_file_created_without_id",
      };
    }

    return {
      accountEmail: access.accountEmail,
      file: {
        createdTime: result.createdTime ?? null,
        fileId,
        fileType,
        mimeType: result.mimeType ?? config.mimeType,
        modifiedTime: result.modifiedTime ?? null,
        title: result.name ?? cleanedTitle,
        url: result.webViewLink ?? config.url(fileId),
      },
      nextStep:
        "The file is blank. Use the matching Google Slides, Docs, or Sheets update tool to add content.",
      ok: true as const,
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      error:
        error instanceof Error
          ? error.message
          : "Unknown Google Drive creation error.",
      ok: false as const,
      reason: "google_workspace_file_creation_failed",
    };
  }
}

function summarizeGoogleDriveReply(reply: GoogleDriveReply) {
  return {
    action: reply.action ?? null,
    author: reply.author?.displayName ?? null,
    authorIsConnectedAccount: reply.author?.me ?? false,
    content: reply.content ?? null,
    createdTime: reply.createdTime ?? null,
    deleted: reply.deleted ?? false,
    id: reply.id ?? null,
    modifiedTime: reply.modifiedTime ?? null,
  };
}

function summarizeGoogleDriveComment(comment: GoogleDriveComment) {
  return {
    author: comment.author?.displayName ?? null,
    authorIsConnectedAccount: comment.author?.me ?? false,
    content: comment.content ?? null,
    createdTime: comment.createdTime ?? null,
    deleted: comment.deleted ?? false,
    id: comment.id ?? null,
    modifiedTime: comment.modifiedTime ?? null,
    quotedFileContent: comment.quotedFileContent?.value ?? null,
    replies: (comment.replies ?? []).map(summarizeGoogleDriveReply),
    resolved: comment.resolved ?? false,
  };
}

export async function inspectGoogleFileReview({
  file,
  includeResolved = true,
}: {
  file: string;
  includeResolved?: boolean;
}) {
  const fileId = extractGoogleDriveFileId(file);

  if (!fileId) {
    return {
      ok: false as const,
      reason: "invalid_google_drive_file_url_or_id",
    };
  }

  const access = await googleDriveFileAccessStatus();

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_drive_file"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants drive.file access."
          : googleDriveFileGuidance(access.accountEmail),
    };
  }

  try {
    const commentsUrl = new URL(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId,
      )}/comments`,
    );
    commentsUrl.searchParams.set(
      "fields",
      "comments(id,content,htmlContent,createdTime,modifiedTime,resolved,deleted,quotedFileContent(mimeType,value),author(displayName,me,photoLink),replies(id,content,htmlContent,createdTime,modifiedTime,deleted,action,author(displayName,me,photoLink)))",
    );
    commentsUrl.searchParams.set("includeDeleted", "false");
    commentsUrl.searchParams.set("pageSize", "100");
    const [metadata, result] = await Promise.all([
      getGoogleDriveFileMetadata({
        accessToken: access.accessToken,
        fileId,
      }),
      googleJson<{ comments?: GoogleDriveComment[] }>(commentsUrl.toString(), {
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
        },
        method: "GET",
      }),
    ]);
    const comments = (result.comments ?? [])
      .filter((comment) => includeResolved || comment.resolved !== true)
      .map(summarizeGoogleDriveComment);

    return {
      accountEmail: access.accountEmail,
      comments,
      file: {
        fileId,
        mimeType: metadata.mimeType ?? null,
        title: metadata.name ?? null,
        url: metadata.webViewLink ?? null,
      },
      limitations: {
        nativeReviewRequest:
          "Google's public APIs do not expose the native Docs/Slides/Sheets request-review UI action.",
        suggestions:
          "Native Google Docs suggestions can be inspected through the Docs inspection tool, but public APIs do not create, accept, or reject suggestion-mode edits.",
      },
      ok: true as const,
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      error:
        error instanceof Error ? error.message : "Unknown Google Drive review error.",
      fileId,
      guidance: googleDriveFileGuidance(access.accountEmail),
      ok: false as const,
      reason: "google_file_review_not_accessible",
    };
  }
}

export async function updateGoogleFileReview({
  action,
  commentId,
  content,
  file,
}: {
  action: "add_comment" | "reply" | "resolve";
  commentId?: string | null;
  content?: string | null;
  file: string;
}) {
  const fileId = extractGoogleDriveFileId(file);
  const cleanedCommentId = commentId?.trim() ?? "";
  const cleanedContent = content?.trim() ?? "";

  if (!fileId) {
    return {
      ok: false as const,
      reason: "invalid_google_drive_file_url_or_id",
    };
  }

  if (
    (action === "add_comment" && !cleanedContent) ||
    (action !== "add_comment" && !cleanedCommentId) ||
    (action === "reply" && !cleanedContent)
  ) {
    return {
      ok: false as const,
      reason: "missing_google_review_action_fields",
    };
  }

  const access = await googleDriveFileAccessStatus();

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_drive_file"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants drive.file access."
          : googleDriveFileGuidance(access.accountEmail),
    };
  }

  try {
    if (action === "add_comment") {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId,
        )}/comments`,
      );
      url.searchParams.set(
        "fields",
        "id,content,createdTime,modifiedTime,resolved,author(displayName,me)",
      );
      const result = await googleJson<GoogleDriveComment>(url.toString(), {
        body: JSON.stringify({
          content: cleanedContent,
        }),
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      return {
        accountEmail: access.accountEmail,
        action,
        comment: summarizeGoogleDriveComment(result),
        fileId,
        ok: true as const,
      };
    }

    const url = new URL(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId,
      )}/comments/${encodeURIComponent(cleanedCommentId)}/replies`,
    );
    url.searchParams.set(
      "fields",
      "id,content,createdTime,modifiedTime,action,author(displayName,me)",
    );
    const result = await googleJson<GoogleDriveReply>(url.toString(), {
      body: JSON.stringify({
        ...(cleanedContent ? { content: cleanedContent } : {}),
        ...(action === "resolve" ? { action: "resolve" } : {}),
      }),
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    return {
      accountEmail: access.accountEmail,
      action,
      commentId: cleanedCommentId,
      fileId,
      ok: true as const,
      reply: summarizeGoogleDriveReply(result),
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      action,
      error:
        error instanceof Error ? error.message : "Unknown Google Drive review error.",
      fileId,
      ok: false as const,
      reason: "google_file_review_update_failed",
    };
  }
}

export async function requestGoogleFileReview({
  file,
  message,
}: {
  file: string;
  message: string;
}) {
  const cleanedMessage = message.trim();

  if (!cleanedMessage) {
    return {
      ok: false as const,
      reason: "missing_review_message",
    };
  }

  const commentResult = await updateGoogleFileReview({
    action: "add_comment",
    content: `CyWorld review request: ${cleanedMessage}`,
    file,
  });

  if (!commentResult.ok) {
    return commentResult;
  }

  const fileId = extractGoogleDriveFileId(file);

  return {
    accountEmail: commentResult.accountEmail,
    comment: commentResult.comment,
    fileId,
    nativeGoogleReviewRequest: false,
    notificationSent: false,
    ok: true as const,
  };
}

export async function inspectSharedGoogleSlides(presentation: string) {
  const presentationId = extractGoogleSlidesPresentationId(presentation);

  if (!presentationId) {
    return {
      ok: false as const,
      reason: "invalid_google_slides_url_or_id",
    };
  }

  const access = await googleSlidesAccessStatus();

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_slides"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants Google Slides access."
          : googleSlidesSharingGuidance(access.accountEmail),
    };
  }

  try {
    const result = await googleJson<GoogleSlidesPresentation>(
      `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(
        presentationId,
      )}`,
      {
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
        },
        method: "GET",
      },
    );

    return {
      accountEmail: access.accountEmail,
      ok: true as const,
      presentation: {
        presentationId: result.presentationId ?? presentationId,
        revisionId: result.revisionId ?? null,
        slides: (result.slides ?? []).map((slide, slideIndex) => ({
          elements: (slide.pageElements ?? []).map((element) => ({
            description: element.description ?? null,
            objectId: element.objectId ?? null,
            text: pageElementText(element),
            title: element.title ?? null,
            type: pageElementType(element),
          })),
          objectId: slide.objectId ?? null,
          slideNumber: slideIndex + 1,
        })),
        title: result.title ?? null,
      },
      sharingRequirement:
        "The presentation must be shared with this connected CyWorld Google account with Editor access before an agent can modify it.",
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      error: error instanceof Error ? error.message : "Unknown Google Slides error.",
      guidance: googleSlidesSharingGuidance(access.accountEmail),
      ok: false as const,
      presentationId,
      reason: "google_slides_not_accessible",
    };
  }
}

export async function updateSharedGoogleSlides({
  presentation,
  requestsJson,
  requiredRevisionId,
}: {
  presentation: string;
  requestsJson: string;
  requiredRevisionId?: string | null;
}) {
  const presentationId = extractGoogleSlidesPresentationId(presentation);

  if (!presentationId) {
    return {
      ok: false as const,
      reason: "invalid_google_slides_url_or_id",
    };
  }

  const parsedRequests = parseGoogleSlidesRequests(requestsJson);

  if (!parsedRequests.ok) {
    return parsedRequests;
  }

  const access = await googleSlidesAccessStatus();

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_slides"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants Google Slides access."
          : googleSlidesSharingGuidance(access.accountEmail),
    };
  }

  try {
    const result = await googleJson<{
      presentationId?: string;
      replies?: unknown[];
      writeControl?: {
        requiredRevisionId?: string;
      };
    }>(
      `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(
        presentationId,
      )}:batchUpdate`,
      {
        body: JSON.stringify({
          requests: parsedRequests.requests,
          ...(requiredRevisionId?.trim()
            ? {
                writeControl: {
                  requiredRevisionId: requiredRevisionId.trim(),
                },
              }
            : {}),
        }),
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );

    return {
      accountEmail: access.accountEmail,
      appliedRequestCount: parsedRequests.requests.length,
      ok: true as const,
      presentationId: result.presentationId ?? presentationId,
      replies: result.replies ?? [],
      writeControl: result.writeControl ?? null,
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      error: error instanceof Error ? error.message : "Unknown Google Slides error.",
      guidance: googleSlidesSharingGuidance(access.accountEmail),
      ok: false as const,
      presentationId,
      reason: "google_slides_update_failed",
    };
  }
}

export async function inspectSharedGoogleDocs(document: string) {
  const documentId = extractGoogleDocsDocumentId(document);

  if (!documentId) {
    return {
      ok: false as const,
      reason: "invalid_google_docs_url_or_id",
    };
  }

  const access = await googleWorkspaceAccessStatus({
    reconnectReason: "google_reconnect_required_for_docs",
    requiredScope: GOOGLE_DOCS_SCOPE,
  });

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_docs"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants Google Docs access."
          : googleWorkspaceSharingGuidance({
              accountEmail: access.accountEmail,
              fileType: "Google Docs",
            }),
    };
  }

  try {
    const documentUrl = new URL(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
        documentId,
      )}`,
    );
    documentUrl.searchParams.set("includeTabsContent", "true");
    documentUrl.searchParams.set("suggestionsViewMode", "SUGGESTIONS_INLINE");
    const result = await googleJson<GoogleDocument>(
      documentUrl.toString(),
      {
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
        },
        method: "GET",
      },
    );
    const suggestionSummary = collectGoogleDocsSuggestions(result);

    return {
      accountEmail: access.accountEmail,
      document: {
        documentId: result.documentId ?? documentId,
        elements: summarizeGoogleDocsElements(result.body?.content),
        revisionId: result.revisionId ?? null,
        tabs: summarizeGoogleDocsTabs(result.tabs),
        title: result.title ?? null,
      },
      suggestions: {
        ids: [...suggestionSummary.ids],
        occurrences: suggestionSummary.occurrences,
        publicApiLimitation:
          "Google Docs suggestions are visible here, but the public Docs API does not create, accept, or reject suggestion-mode edits.",
      },
      ok: true as const,
      sharingRequirement:
        "The document must be shared with this connected CyWorld Google account with Editor access before an agent can modify it.",
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      documentId,
      error: error instanceof Error ? error.message : "Unknown Google Docs error.",
      guidance: googleWorkspaceSharingGuidance({
        accountEmail: access.accountEmail,
        fileType: "Google Docs",
      }),
      ok: false as const,
      reason: "google_docs_not_accessible",
    };
  }
}

export async function updateSharedGoogleDocs({
  document,
  requestsJson,
  requiredRevisionId,
}: {
  document: string;
  requestsJson: string;
  requiredRevisionId?: string | null;
}) {
  const documentId = extractGoogleDocsDocumentId(document);

  if (!documentId) {
    return {
      ok: false as const,
      reason: "invalid_google_docs_url_or_id",
    };
  }

  const parsedRequests = parseGoogleDocsRequests(requestsJson);

  if (!parsedRequests.ok) {
    return parsedRequests;
  }

  const access = await googleWorkspaceAccessStatus({
    reconnectReason: "google_reconnect_required_for_docs",
    requiredScope: GOOGLE_DOCS_SCOPE,
  });

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_docs"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants Google Docs access."
          : googleWorkspaceSharingGuidance({
              accountEmail: access.accountEmail,
              fileType: "Google Docs",
            }),
    };
  }

  try {
    const result = await googleJson<{
      documentId?: string;
      replies?: unknown[];
      writeControl?: {
        requiredRevisionId?: string;
      };
    }>(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
        documentId,
      )}:batchUpdate`,
      {
        body: JSON.stringify({
          requests: parsedRequests.requests,
          ...(requiredRevisionId?.trim()
            ? {
                writeControl: {
                  requiredRevisionId: requiredRevisionId.trim(),
                },
              }
            : {}),
        }),
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );

    return {
      accountEmail: access.accountEmail,
      appliedRequestCount: parsedRequests.requests.length,
      documentId: result.documentId ?? documentId,
      ok: true as const,
      replies: result.replies ?? [],
      writeControl: result.writeControl ?? null,
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      documentId,
      error: error instanceof Error ? error.message : "Unknown Google Docs error.",
      guidance: googleWorkspaceSharingGuidance({
        accountEmail: access.accountEmail,
        fileType: "Google Docs",
      }),
      ok: false as const,
      reason: "google_docs_update_failed",
    };
  }
}

export async function inspectSharedGoogleSheets({
  rangesJson,
  spreadsheet,
}: {
  rangesJson?: string | null;
  spreadsheet: string;
}) {
  const spreadsheetId = extractGoogleSheetsSpreadsheetId(spreadsheet);

  if (!spreadsheetId) {
    return {
      ok: false as const,
      reason: "invalid_google_sheets_url_or_id",
    };
  }

  const parsedRanges = parseGoogleSheetsRanges(rangesJson);

  if (!parsedRanges.ok) {
    return parsedRanges;
  }

  const access = await googleWorkspaceAccessStatus({
    reconnectReason: "google_reconnect_required_for_sheets",
    requiredScope: GOOGLE_SHEETS_SCOPE,
  });

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_sheets"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants Google Sheets access."
          : googleWorkspaceSharingGuidance({
              accountEmail: access.accountEmail,
              fileType: "Google Sheets",
            }),
    };
  }

  try {
    const metadata = await googleJson<GoogleSpreadsheet>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}?includeGridData=false`,
      {
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
        },
        method: "GET",
      },
    );
    let valueRanges: GoogleValueRange[] = [];

    if (parsedRanges.ranges.length) {
      const valuesUrl = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}/values:batchGet`,
      );

      for (const range of parsedRanges.ranges) {
        valuesUrl.searchParams.append("ranges", range);
      }

      valuesUrl.searchParams.set("majorDimension", "ROWS");
      valuesUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
      const values = await googleJson<{ valueRanges?: GoogleValueRange[] }>(
        valuesUrl.toString(),
        {
          headers: {
            Authorization: `Bearer ${access.accessToken}`,
          },
          method: "GET",
        },
      );
      valueRanges = values.valueRanges ?? [];
    }

    return {
      accountEmail: access.accountEmail,
      ok: true as const,
      sharingRequirement:
        "The spreadsheet must be shared with this connected CyWorld Google account with Editor access before an agent can modify it.",
      spreadsheet: {
        locale: metadata.properties?.locale ?? null,
        sheets: (metadata.sheets ?? []).map((sheet) => ({
          columnCount: sheet.properties?.gridProperties?.columnCount ?? null,
          frozenColumnCount:
            sheet.properties?.gridProperties?.frozenColumnCount ?? null,
          frozenRowCount:
            sheet.properties?.gridProperties?.frozenRowCount ?? null,
          index: sheet.properties?.index ?? null,
          rowCount: sheet.properties?.gridProperties?.rowCount ?? null,
          sheetId: sheet.properties?.sheetId ?? null,
          sheetType: sheet.properties?.sheetType ?? null,
          title: sheet.properties?.title ?? null,
        })),
        spreadsheetId: metadata.spreadsheetId ?? spreadsheetId,
        spreadsheetUrl: metadata.spreadsheetUrl ?? null,
        timeZone: metadata.properties?.timeZone ?? null,
        title: metadata.properties?.title ?? null,
        valueRanges: valueRanges.map((range) => ({
          majorDimension: range.majorDimension ?? null,
          range: range.range ?? null,
          values: range.values ?? [],
        })),
      },
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      error: error instanceof Error ? error.message : "Unknown Google Sheets error.",
      guidance: googleWorkspaceSharingGuidance({
        accountEmail: access.accountEmail,
        fileType: "Google Sheets",
      }),
      ok: false as const,
      reason: "google_sheets_not_accessible",
      spreadsheetId,
    };
  }
}

export async function updateSharedGoogleSheets({
  requestsJson,
  spreadsheet,
}: {
  requestsJson: string;
  spreadsheet: string;
}) {
  const spreadsheetId = extractGoogleSheetsSpreadsheetId(spreadsheet);

  if (!spreadsheetId) {
    return {
      ok: false as const,
      reason: "invalid_google_sheets_url_or_id",
    };
  }

  const parsedRequests = parseGoogleSheetsRequests(requestsJson);

  if (!parsedRequests.ok) {
    return parsedRequests;
  }

  const access = await googleWorkspaceAccessStatus({
    reconnectReason: "google_reconnect_required_for_sheets",
    requiredScope: GOOGLE_SHEETS_SCOPE,
  });

  if (!access.ok) {
    return {
      ...access,
      guidance:
        access.reason === "google_reconnect_required_for_sheets"
          ? "Reconnect Google from CyWorld Admin Settings once so the shared account grants Google Sheets access."
          : googleWorkspaceSharingGuidance({
              accountEmail: access.accountEmail,
              fileType: "Google Sheets",
            }),
    };
  }

  try {
    const result = await googleJson<{
      replies?: unknown[];
      spreadsheetId?: string;
      updatedSpreadsheet?: GoogleSpreadsheet;
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}:batchUpdate`,
      {
        body: JSON.stringify({
          includeSpreadsheetInResponse: false,
          requests: parsedRequests.requests,
        }),
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );

    return {
      accountEmail: access.accountEmail,
      appliedRequestCount: parsedRequests.requests.length,
      ok: true as const,
      replies: result.replies ?? [],
      spreadsheetId: result.spreadsheetId ?? spreadsheetId,
    };
  } catch (error) {
    return {
      accountEmail: access.accountEmail,
      error: error instanceof Error ? error.message : "Unknown Google Sheets error.",
      guidance: googleWorkspaceSharingGuidance({
        accountEmail: access.accountEmail,
        fileType: "Google Sheets",
      }),
      ok: false as const,
      reason: "google_sheets_update_failed",
      spreadsheetId,
    };
  }
}

function getHeader(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ??
    null
  );
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function extractMessageBody(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidate = payload as {
    body?: { data?: string };
    mimeType?: string;
    parts?: unknown[];
  };

  if (candidate.mimeType === "text/plain" && candidate.body?.data) {
    return decodeBase64Url(candidate.body.data).trim();
  }

  if (Array.isArray(candidate.parts)) {
    const plain = candidate.parts
      .map((part) => extractMessageBody(part))
      .find((part) => part.trim());

    if (plain) {
      return plain;
    }
  }

  if (candidate.body?.data) {
    return decodeBase64Url(candidate.body.data).trim();
  }

  return "";
}

function parseGoogleDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseInternalDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

function buildPlainTextMessage({
  body,
  cc,
  from,
  subject,
  to,
}: {
  body: string;
  cc?: string | null;
  from: string | null;
  subject: string;
  to: string;
}) {
  return [
    `To: ${sanitizeHeader(to)}`,
    cc ? `Cc: ${sanitizeHeader(cc)}` : null,
    from ? `From: ${sanitizeHeader(from)}` : null,
    `Subject: ${sanitizeHeader(subject)}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ]
    .filter((line): line is string => line !== null)
    .join("\r\n");
}

function buildMultipartMessage({
  attachments,
  body,
  cc,
  from,
  subject,
  to,
}: {
  attachments: {
    content: string;
    contentType: string;
    filename: string;
  }[];
  body: string;
  cc?: string | null;
  from: string | null;
  subject: string;
  to: string;
}) {
  const boundary = `cyworld-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const parts = [
    [
      `To: ${sanitizeHeader(to)}`,
      cc ? `Cc: ${sanitizeHeader(cc)}` : null,
      from ? `From: ${sanitizeHeader(from)}` : null,
      `Subject: ${sanitizeHeader(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ]
      .filter((line): line is string => line !== null)
      .join("\r\n"),
    ...attachments.map((attachment) =>
      [
        `--${boundary}`,
        `Content-Type: ${attachment.contentType}; name="${sanitizeHeader(attachment.filename)}"`,
        `Content-Disposition: attachment; filename="${sanitizeHeader(attachment.filename)}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(Buffer.from(attachment.content, "utf8").toString("base64")),
      ].join("\r\n"),
    ),
    `--${boundary}--`,
  ];

  return parts.join("\r\n");
}

export async function sendSharedGmail({
  attachments = [],
  body,
  cc,
  subject,
  to,
}: {
  attachments?: {
    content: string;
    contentType: string;
    filename: string;
  }[];
  body: string;
  cc?: string | null;
  subject: string;
  to: string;
}) {
  const access = await getGoogleAccess();

  if (!access) {
    return {
      ok: false,
      reason: "google_not_connected",
    };
  }

  const message =
    attachments.length > 0
      ? buildMultipartMessage({
          attachments,
          body,
          cc,
          from: access.accountEmail,
          subject,
          to,
        })
      : buildPlainTextMessage({
          body,
          cc,
          from: access.accountEmail,
          subject,
          to,
        });
  const result = await googleJson<{ id?: string }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      body: JSON.stringify({
        raw: base64UrlEncode(message),
      }),
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  return {
    accountEmail: access.accountEmail,
    messageId: result.id ?? null,
    threadId: (result as { threadId?: string }).threadId ?? null,
    ok: true,
  };
}

export async function listSharedGmailInboxMessages({
  maxResults = 25,
  query = "in:inbox newer_than:14d",
}: {
  maxResults?: number;
  query?: string;
} = {}) {
  const access = await getGoogleAccess();

  if (!access) {
    return {
      messages: [] as GmailMessageView[],
      ok: false,
      reason: "google_not_connected",
    };
  }

  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", String(maxResults));
  listUrl.searchParams.set("q", query);

  const list = await googleJson<{ messages?: Array<{ id?: string; threadId?: string }> }>(
    listUrl.toString(),
    {
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
      },
      method: "GET",
    },
  );

  const messages = await Promise.all(
    (list.messages ?? [])
      .filter((message): message is { id: string; threadId: string } =>
        Boolean(message.id && message.threadId),
      )
      .map(async (message) => {
        const detailUrl = new URL(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
        );
        detailUrl.searchParams.set("format", "full");
        const detail = await googleJson<{
          id?: string;
          internalDate?: string;
          payload?: {
            headers?: Array<{ name?: string; value?: string }>;
          };
          snippet?: string;
          threadId?: string;
        }>(detailUrl.toString(), {
          headers: {
            Authorization: `Bearer ${access.accessToken}`,
          },
          method: "GET",
        });
        const headers = detail.payload?.headers;

        return {
          body: extractMessageBody(detail.payload),
          cc: getHeader(headers, "Cc"),
          date: parseGoogleDate(getHeader(headers, "Date")),
          from: getHeader(headers, "From"),
          id: detail.id ?? message.id,
          internalDate: parseInternalDate(detail.internalDate),
          snippet: detail.snippet ?? "",
          subject: getHeader(headers, "Subject"),
          threadId: detail.threadId ?? message.threadId,
          to: getHeader(headers, "To"),
        } satisfies GmailMessageView;
      }),
  );

  return {
    messages,
    ok: true,
  };
}
