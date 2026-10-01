// Read-only Graph discovery. Never returns Graph error bodies or access tokens.
const ROOT = "https://graph.microsoft.com/v1.0/me/drive/root/children";
const MAX_PAGES = 20;
const MAX_ITEMS = 5000;
const DEADLINE_MS = 20000;
export class DiscoveryError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}
export interface WorkbookFile {
  id: string;
  name: string;
}

function workbook(item: any): WorkbookFile | null {
  if (!item || typeof item !== "object") {
    throw new DiscoveryError("ONEDRIVE_RESPONSE_INVALID");
  }
  if (
    !item.file || typeof item.name !== "string" || !/\.xlsx?$/i.test(item.name)
  ) return null;
  if (typeof item.id !== "string" || !item.id) {
    throw new DiscoveryError("ONEDRIVE_RESPONSE_INVALID");
  }
  return { id: item.id, name: item.name };
}

async function graphGet(
  url: string,
  accessToken: string,
  deadline: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DiscoveryError("ONEDRIVE_DISCOVERY_TIMEOUT");
  try {
    return await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(10000, remaining)),
    });
  } catch {
    throw new DiscoveryError("ONEDRIVE_DISCOVERY_REQUEST_FAILED");
  }
}
async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    throw new DiscoveryError("ONEDRIVE_RESPONSE_INVALID");
  }
}
function nextPage(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value) {
    throw new DiscoveryError("ONEDRIVE_PAGINATION_INVALID");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DiscoveryError("ONEDRIVE_PAGINATION_INVALID");
  }
  // Never send the stored token to another host, endpoint, or redirect.
  if (
    url.origin !== "https://graph.microsoft.com" || url.username ||
    url.password || url.hash ||
    url.pathname !== "/v1.0/me/drive/root/children"
  ) throw new DiscoveryError("ONEDRIVE_PAGINATION_INVALID");
  return url.href;
}
export async function listRootWorkbooks(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  let next: string | null = ROOT + "?$select=id,name,file&$top=200";
  const visited = new Set<string>();
  const files = new Map<string, WorkbookFile>();
  const deadline = Date.now() + DEADLINE_MS;
  let pages = 0, totalItems = 0;
  while (next) {
    if (pages >= MAX_PAGES || visited.has(next)) {
      throw new DiscoveryError("ONEDRIVE_PAGINATION_LIMIT_OR_LOOP");
    }
    visited.add(next);
    const res = await graphGet(next, accessToken, deadline, fetchImpl);
    if (!res.ok) throw new DiscoveryError(`ONEDRIVE_LIST_HTTP_${res.status}`);
    const json = await readJson(res);
    if (!Array.isArray(json?.value)) {
      throw new DiscoveryError("ONEDRIVE_RESPONSE_INVALID");
    }
    totalItems += json.value.length;
    if (totalItems > MAX_ITEMS) throw new DiscoveryError("ONEDRIVE_ITEM_LIMIT");
    for (const item of json.value) {
      const file = workbook(item);
      if (!file) continue;
      const previous = files.get(file.id);
      if (previous && previous.name !== file.name) {
        throw new DiscoveryError("ONEDRIVE_LIST_CHANGED_DURING_READ");
      }
      files.set(file.id, file);
    }
    pages++;
    next = nextPage(json["@odata.nextLink"]);
  }
  return { files: [...files.values()], pages, complete: true, scope: "root" };
}
export function validateRootFilename(
  name: string | null,
): asserts name is string {
  if (
    !name || name.length > 255 || name !== name.trim() ||
    /[\/\\:\u0000-\u001f\u007f]/.test(name) ||
    !/\.xlsx?$/i.test(name)
  ) throw new DiscoveryError("ROOT_EXCEL_FILENAME_REQUIRED", 400);
}
export async function lookupRootWorkbook(
  name: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  validateRootFilename(name);
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${
    encodeURIComponent(name)
  }?$select=id,name,file`;
  const res = await graphGet(
    url,
    accessToken,
    Date.now() + DEADLINE_MS,
    fetchImpl,
  );
  if (res.status === 404) return { found: false, file: null };
  if (!res.ok) throw new DiscoveryError(`ONEDRIVE_LOOKUP_HTTP_${res.status}`);
  const file = workbook(await readJson(res));
  if (!file) throw new DiscoveryError("ONEDRIVE_LOOKUP_NOT_AN_EXCEL_FILE");
  return { found: true, file };
}
