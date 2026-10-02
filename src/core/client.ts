/** HTTP client wrapper for Books providers */

import { ResponseError, normalizeError } from "./errors.ts";
import { trimPartialUtf8 } from "./text.ts";
import { version } from "../version.ts";

/**
 * Identifying User-Agent.
 *
 * Every backend answers this string, the two catalogs read as HTML included. Open Library and
 * the National Library ask automated clients to identify themselves, which this satisfies;
 * there is no reason to imitate a browser.
 */
const USER_AGENT = `agntn-books/${version} (+https://github.com/agntn/books)`;

/** Request metadata shared by the HTTP helpers. */
export interface ClientOptions {
  /** Request timeout in milliseconds; defaults to 15 seconds. */
  timeout?: number;
  /** Registry key of the provider on whose behalf the request is made, for error attribution. */
  provider?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * One retry, and only because every request this library makes is a GET.
 *
 * Gutendex in particular answers in under half a second most of the time and drops the
 * connection outright now and then - measured during the pre-scaffold audit, where the same
 * query timed out at twelve seconds and then returned in four. A single repeat turns that into
 * a slow answer rather than an error the caller has to understand.
 */
const RETRIES = 1;

/** Statuses worth the retry. A request that got no response is retried too. */
const RETRY_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Statuses whose response never carries a body. */
const EMPTY_STATUS_CODES = new Set([101, 204, 205, 304]);

/** How a response body is read: parsed as JSON where it parses, as text, or as raw bytes. */
type BodyFormat = "json" | "text" | "bytes";

interface Reply {
  status: number;
  headers: Headers;
  data: unknown;
}

type Attempt = { reply: Reply } | { error: unknown; retry: boolean };

/** GET with the shared headers and the one retry; failures leave here normalized. */
async function get(
  url: string,
  request: { accept: string; range?: string; format: BodyFormat },
  options?: ClientOptions,
): Promise<Reply> {
  const headers: Record<string, string> = { Accept: request.accept, "User-Agent": USER_AGENT };
  if (request.range) headers.Range = request.range;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  try {
    for (let retries = RETRIES; ; retries -= 1) {
      const outcome = await attempt(url, headers, request.format, timeout);
      if ("reply" in outcome) return outcome.reply;
      if (retries <= 0 || !outcome.retry) throw outcome.error;
    }
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

/** One request under its own deadline, so the repeat after a timeout gets a full one. */
async function attempt(
  url: string,
  headers: Record<string, string>,
  format: BodyFormat,
  timeout: number,
): Promise<Attempt> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: timeout > 0 ? AbortSignal.timeout(timeout) : undefined,
    });
  } catch (error) {
    return { error, retry: true };
  }
  if (response.status >= 400 && response.status < 600) {
    const body = await response.text();
    return {
      error: new ResponseError(response.status, url, body, response.headers),
      retry: RETRY_STATUS_CODES.has(response.status),
    };
  }
  const data = await readBody(response, format);
  return { reply: { status: response.status, headers: response.headers, data } };
}

/** Read a response body in the requested format; a bodiless status reads as nothing. */
async function readBody(response: Response, format: BodyFormat): Promise<unknown> {
  if (!response.body || EMPTY_STATUS_CODES.has(response.status)) return undefined;
  if (format === "bytes") return response.arrayBuffer();
  const text = await response.text();
  return format === "json" ? parseJSON(text) : text;
}

/** JSON when the text parses, the text itself otherwise, without keys that reach a prototype. */
function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) =>
      key === "__proto__" ||
      (key === "constructor" && typeof value === "object" && value !== null && "prototype" in value)
        ? undefined
        : value,
    );
  } catch {
    return text;
  }
}

/**
 * Fetch JSON with Books headers and a 15-second default timeout.
 *
 * Transport failures are normalized before they leave this boundary.
 */
export async function getJSON<T>(url: string, options?: ClientOptions): Promise<T> {
  const reply = await get(url, { accept: "application/json", format: "json" }, options);
  return reply.data as T;
}

/** Fetch an HTML page as text, even when the server labels it JSON. */
export async function getText(url: string, options?: ClientOptions): Promise<string> {
  const reply = await get(
    url,
    { accept: "text/html,application/xhtml+xml", format: "text" },
    options,
  );
  return typeof reply.data === "string" ? reply.data : "";
}

/** One slice of a text file, with the byte bookkeeping needed to ask for the next one. */
export interface TextSlice {
  /** Decoded text of the slice */
  text: string;
  /** Byte offset the returned text starts at */
  offset: number;
  /** How many bytes of the file the returned text covers */
  bytes: number;
  /** Size of the whole file, when the server reports it */
  totalBytes?: number;
  /** True when the file continues past this slice */
  truncated: boolean;
  /** Offset to request next, absent once the end of the file is reached */
  nextOffset?: number;
}

/** Read `bytes 0-100/448885` off a `Content-Range` header. */
function parseTotalBytes(contentRange: string | null): number | undefined {
  const total = Number(contentRange?.match(/\/(\d+)\s*$/)?.[1]);
  return Number.isFinite(total) ? total : undefined;
}

/**
 * Read part of a plain-text file over HTTP, asking for a byte range.
 *
 * Books run to hundreds of kilobytes, so the whole point is not to move a novel across the wire
 * to show a page of it. A server that ignores `Range` answers 200 with the entire file, which is
 * why the slice is applied locally as well - Gutenberg and Wolne Lektury both honor the header,
 * but a mirror or a proxy need not.
 *
 * The decoded text is trimmed to whole UTF-8 characters: a byte range cuts wherever it lands,
 * and half of `ł` is not a character.
 */
export async function readTextSlice(
  url: string,
  range: { offset: number; maxBytes: number },
  options?: ClientOptions,
): Promise<TextSlice> {
  const { offset, maxBytes } = range;
  const response = await get(
    url,
    { accept: "text/plain", range: `bytes=${offset}-${offset + maxBytes - 1}`, format: "bytes" },
    options,
  );

  const body = new Uint8Array((response.data as ArrayBuffer | undefined) ?? new ArrayBuffer(0));
  const served = response.status === 206;
  const totalBytes = served
    ? parseTotalBytes(response.headers.get("content-range"))
    : body.byteLength;
  const chunk = served ? body : body.subarray(offset, offset + maxBytes);

  const trimmed = trimPartialUtf8(chunk, {
    start: offset > 0,
    end: chunk.byteLength >= maxBytes,
  });
  const start = offset + trimmed.leading;
  const bytes = trimmed.bytes.byteLength;
  const nextOffset = start + bytes;
  const truncated =
    totalBytes === undefined ? chunk.byteLength >= maxBytes : nextOffset < totalBytes;

  return {
    text: new TextDecoder("utf-8").decode(trimmed.bytes),
    offset: start,
    bytes,
    totalBytes,
    truncated,
    nextOffset: truncated ? nextOffset : undefined,
  };
}

/**
 * Build a query string while dropping parameters whose value is `undefined`.
 *
 * @example
 *   ```ts
 *   buildQuery({ q: "dune", limit: undefined }); // '?q=dune'
 *   ```
 */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}
