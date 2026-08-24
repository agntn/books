/** HTTP client wrapper for Books providers */

import { ofetch } from "ofetch";
import { normalizeError } from "./errors.ts";
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

/**
 * Fetch JSON with Books headers and a 15-second default timeout.
 *
 * Transport failures are normalized before they leave this boundary.
 */
export async function getJSON<T>(url: string, options?: ClientOptions): Promise<T> {
  try {
    return await ofetch<T>(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      retry: RETRIES,
    });
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

/**
 * Fetch an HTML page as text, for the providers that read their records out of markup.
 *
 * `responseType: "text"` is explicit: without it ofetch decides from the response content type,
 * and a site answering `application/json` for an error page would hand back an object.
 */
export async function getText(url: string, options?: ClientOptions): Promise<string> {
  try {
    return await ofetch<string, "text">(url, {
      method: "GET",
      responseType: "text",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
      timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      retry: RETRIES,
    });
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
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
  try {
    const response = await ofetch.raw<ArrayBuffer, "arrayBuffer">(url, {
      method: "GET",
      responseType: "arrayBuffer",
      headers: {
        Accept: "text/plain",
        Range: `bytes=${offset}-${offset + maxBytes - 1}`,
        "User-Agent": USER_AGENT,
      },
      timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      retry: RETRIES,
    });

    const body = new Uint8Array(response._data ?? new ArrayBuffer(0));
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
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
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
