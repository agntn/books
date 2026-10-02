import { describe, expect, it } from "vitest";
import {
  AuthError,
  BooksError,
  HTTPError,
  NotFoundError,
  PaymentError,
  RateLimitError,
  ResponseError,
  normalizeError,
} from "../../src/core/errors.ts";

/** Build the structured failure the client raises, which is what normalizeError reads. */
function responseError(
  status: number,
  url: string,
  headers?: Record<string, string>,
): ResponseError {
  return new ResponseError(status, url, "", new Headers(headers));
}

describe("secret redaction", () => {
  it("redacts credentials in every message that reaches a caller", () => {
    const error = new BooksError("failed for https://x.test/v1?key=SECRET&q=dune");
    expect(error.message).toContain("key=REDACTED");
    expect(error.message).not.toContain("SECRET");
  });

  it("redacts the request URL and a response body that echoes it", () => {
    // Redaction targets credentials carried as query parameters - the shape a URL echoed back
    // in an error body takes. Free text in a body is left alone; mangling it would hide the
    // very message a caller needs to understand the failure.
    const error = new HTTPError(
      500,
      "https://x.test?api_key=SECRET",
      "denied for https://x.test?api_key=SECRET",
      "x",
    );
    expect(error.message).not.toContain("SECRET");
    expect(error.rawUrl).not.toContain("SECRET");
    expect(error.body).toContain("api_key=REDACTED");
    expect(error.body).not.toContain("SECRET");
  });

  it("redacts a credential carried in a path segment, not only in a query", () => {
    // Alchemy, Infura and QuickNode key by path, where a query-parameter rule never looks - and
    // this message reaches a model through the MCP server, not only the operator who owns it.
    const error = new HTTPError(
      429,
      "https://mainnet.vendor.test/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      undefined,
      "x",
    );
    expect(error.message).toContain("/v3/REDACTED");
    expect(error.message).not.toContain("9aa3d95b3bc440fa88ea12eaa4456161");
    expect(error.message).toContain("mainnet.vendor.test");
  });

  it("leaves the identifiers this library actually requests intact", () => {
    // The negative control: redacting these would trade a diagnosable 404 for a useless one.
    for (const url of [
      "https://openlibrary.org/books/OL7524304M.json",
      "https://openlibrary.org/works/OL893414W/ratings.json",
      "https://www.gutenberg.org/ebooks/84.txt.utf-8",
      "https://wolnelektury.pl/media/book/txt/lalka-tom-pierwszy.txt",
      "https://lubimyczytac.pl/ksiazka/4942534/diuna",
      "https://s.lubimyczytac.pl/upload/books/4942000/4942534/1177545-352x500.jpg",
    ]) {
      expect(new HTTPError(404, url, undefined, "x").message).toContain(url);
    }
  });

  it("keeps rawUrl out of serialized errors", () => {
    const error = new HTTPError(500, "https://x.test", undefined, "x");
    expect(Object.keys({ ...error })).not.toContain("rawUrl");
  });
});

describe("normalizeError", () => {
  it("passes an existing Books error through untouched", () => {
    const original = new NotFoundError("book", "bn");
    expect(normalizeError(original, "openlibrary")).toBe(original);
  });

  it("maps statuses onto the hierarchy by structured status, not message text", () => {
    expect(normalizeError(responseError(404, "https://x.test"), "bn")).toBeInstanceOf(
      NotFoundError,
    );
    expect(normalizeError(responseError(401, "https://x.test"), "bn")).toBeInstanceOf(AuthError);
    expect(normalizeError(responseError(402, "https://x.test"), "bn")).toBeInstanceOf(PaymentError);
    // A public catalog answering 403 has refused the client, not asked it to pay.
    expect(normalizeError(responseError(403, "https://x.test"), "bn")).toBeInstanceOf(AuthError);
    expect(normalizeError(responseError(500, "https://x.test"), "bn")).toBeInstanceOf(HTTPError);
  });

  it("reads retry-after off the response headers", () => {
    const error = normalizeError(
      responseError(429, "https://x.test", { "retry-after": "30" }),
      "openlibrary",
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(30);
  });

  it("keeps the status and provider of a server failure", () => {
    const error = normalizeError(responseError(503, "https://gutendex.com/books"), "gutendex");
    expect((error as HTTPError).statusCode).toBe(503);
    expect(error.provider).toBe("gutendex");
  });

  it("turns a transport failure into an HTTPError with no status", () => {
    const error = normalizeError(new Error("ETIMEDOUT"), "gutendex");
    expect(error).toBeInstanceOf(HTTPError);
    expect((error as HTTPError).statusCode).toBe(0);
  });

  it("wraps anything else as the base error", () => {
    const error = normalizeError("something odd", "bn");
    expect(error.name).toBe("BooksError");
    expect(error.message).toBe("something odd");
  });
});
