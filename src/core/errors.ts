/** Books error hierarchy */

import { FetchError } from "ofetch";

/**
 * Base class for failures surfaced through Books.
 *
 * Every message passes through `sanitizeUrl` here, so a credential in a query string is redacted
 * at one boundary. No built-in provider sends one, but an externally registered provider can,
 * and the redaction has to be in place before its errors reach a log.
 */
export class BooksError extends Error {
  readonly provider?: string;

  constructor(message: string, provider?: string) {
    super(sanitizeUrl(message));
    this.name = "BooksError";
    this.provider = provider;
  }
}

/** Strip API keys from URLs and URL-bearing text for safe error messages. */
function sanitizeUrl(url: string): string {
  return url.replace(/([?&])(api[-_]?key|key|secret|token)=[^&#]*/gi, "$1$2=REDACTED");
}

/** HTTP failure with a redacted request URL in its message and a redacted response body. */
export class HTTPError extends BooksError {
  readonly statusCode: number;

  /** Request URL with secrets redacted. Non-enumerable to keep serialized errors compact. */
  readonly rawUrl: string;

  /** Response body, redacted in case the server echoes the request URL. */
  readonly body?: string;

  constructor(statusCode: number, url: string, body?: string, provider?: string) {
    super(`HTTP ${statusCode} from ${url}`, provider);
    this.statusCode = statusCode;
    if (body !== undefined) this.body = sanitizeUrl(body);
    this.rawUrl = sanitizeUrl(url);
    Object.defineProperty(this, "rawUrl", { enumerable: false });
    this.name = "HTTPError";
  }
}

/** Provider credentials were missing, rejected, or the provider refused the client. */
export class AuthError extends BooksError {
  constructor(provider: string, detail?: string) {
    super(`Authentication failed for ${provider}${detail ? `: ${detail}` : ""}`, provider);
    this.name = "AuthError";
  }
}

/** Provider demands payment or a higher plan for the request. */
export class PaymentError extends BooksError {
  readonly statusCode: number;

  constructor(provider: string, statusCode = 402) {
    super(`Payment required by ${provider} (HTTP ${statusCode})`, provider);
    this.statusCode = statusCode;
    this.name = "PaymentError";
  }
}

/** Provider refused a request because its rate limit was reached. */
export class RateLimitError extends BooksError {
  readonly retryAfter?: number;

  constructor(provider: string, retryAfter?: number) {
    super(
      `Rate limited by ${provider}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
      provider,
    );
    this.retryAfter = retryAfter;
    this.name = "RateLimitError";
  }
}

/** The provider's catalog has no such book. */
export class NotFoundError extends BooksError {
  constructor(resource: string, provider?: string) {
    super(`Not found: ${resource}`, provider);
    this.name = "NotFoundError";
  }
}

/**
 * A page or record was served but the fields this library needs were missing.
 *
 * This is the failure mode of the providers that read HTML: the site answered, so the request
 * was fine, but the layout no longer matches the selector. It is distinct from `NotFoundError`,
 * which means the catalog itself has no such entry.
 */
export class ParseError extends BooksError {
  /** Page whose markup could not be read. */
  readonly url?: string;

  constructor(detail: string, provider: string, url?: string) {
    super(`Could not read a book record from ${provider}: ${detail}`, provider);
    this.url = url;
    this.name = "ParseError";
  }
}

/** Provider backend does not expose the requested operation. */
export class UnsupportedOperationError extends BooksError {
  constructor(operation: string, provider: string) {
    super(`Operation "${operation}" not supported by ${provider}`, provider);
    this.name = "UnsupportedOperationError";
  }
}

/** Registry does not contain the requested provider name. */
export class UnknownProviderError extends BooksError {
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`, provider);
    this.name = "UnknownProviderError";
  }
}

/** Caller input failed validation before any request was sent. */
export class InvalidInputError extends BooksError {
  constructor(message: string, provider?: string) {
    super(message, provider);
    this.name = "InvalidInputError";
  }
}

function getFetchErrorUrl(error: FetchError): string | undefined {
  const request = error.request;
  return typeof request === "string" ? request : request?.url;
}

function getFetchErrorBody(error: FetchError): string | undefined {
  if (typeof error.data === "string") return error.data;
  if (error.data === undefined) return undefined;
  try {
    return JSON.stringify(error.data);
  } catch {
    return String(error.data);
  }
}

/**
 * Turn an unknown provider or transport failure into the Books error hierarchy.
 *
 * Existing `BooksError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL.
 *
 * HTTP 403 maps onto `AuthError`, not `PaymentError`: on a public catalog a 403 means the
 * service refused the client - a blocked user agent, a country restriction - and none of these
 * backends charges for access.
 */
export function normalizeError(error: unknown, provider?: string, requestUrl?: string): BooksError {
  if (error instanceof BooksError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  const fetchError = error instanceof FetchError ? error : undefined;
  const statusMatch = message.match(/HTTP (\d{3})/i);
  const status = fetchError?.statusCode ?? Number(statusMatch?.[1] ?? 0);
  const url = requestUrl ?? (fetchError ? getFetchErrorUrl(fetchError) : undefined);
  const resource = url ?? message;

  if (status === 404 || lowerMessage.includes("not found")) {
    return new NotFoundError(resource, provider);
  }

  if (status === 429 || lowerMessage.includes("rate limit")) {
    const retryAfter = Number(fetchError?.response?.headers?.get("retry-after") ?? Number.NaN);
    return new RateLimitError(
      provider ?? "unknown",
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }

  if (status === 402) {
    return new PaymentError(provider ?? "unknown", status);
  }

  if (status === 401 || status === 403 || lowerMessage.includes("unauthorized")) {
    const detail = url ? `HTTP ${status} from ${url}` : message;
    return new AuthError(provider ?? "unknown", detail);
  }

  if (
    status > 0 ||
    url ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("timeouterror")
  ) {
    return new HTTPError(
      status,
      url ?? "unknown",
      (fetchError ? getFetchErrorBody(fetchError) : undefined) ?? message,
      provider,
    );
  }

  return new BooksError(message, provider);
}
