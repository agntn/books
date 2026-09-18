import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQuery, getJSON, readTextSlice } from "../../src/core/client.ts";
import { FAKE_TEXT, FAKE_TEXT_BYTES } from "../helpers.ts";
import { stubRoutes } from "../helpers.ts";

const FILE_URL = "https://example.test/book.txt";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Signal = AbortSignal | null | undefined;

/** Stub fetch as undici would: an aborted signal rejects unsent, a live one reaches `respond`. */
function stubAttempts(respond: (attempt: number, signal: Signal) => Promise<Response>) {
  let attempt = 0;
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    init?.signal?.aborted
      ? Promise.reject(init.signal.reason)
      : respond((attempt += 1), init?.signal),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** A request that never answers: it settles only when its signal aborts. */
function stall(signal: Signal): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** A connection reset `delay` milliseconds in, before any byte of a response. */
function reset(delay: number): Promise<Response> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new TypeError("fetch failed")), delay);
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

describe("retry", () => {
  it("sends the repeat after a timeout instead of aborting it on arrival", async () => {
    const fetch = stubAttempts((attempt, signal) =>
      attempt === 1 ? stall(signal) : Promise.resolve(json({ ok: true })),
    );

    await expect(getJSON(FILE_URL, { timeout: 50 })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives the repeat after a dropped connection the whole timeout", async () => {
    const lifetimes: number[] = [];
    stubAttempts((attempt, signal) => {
      if (attempt === 1) return reset(150);
      const started = performance.now();
      signal?.addEventListener("abort", () => lifetimes.push(performance.now() - started), {
        once: true,
      });
      return stall(signal);
    });

    await expect(getJSON(FILE_URL, { timeout: 200 })).rejects.toMatchObject({
      name: "HTTPError",
      statusCode: 0,
    });
    expect(lifetimes[0]).toBeGreaterThanOrEqual(150);
  });
});

describe("buildQuery", () => {
  it("drops undefined parameters and encodes the rest", () => {
    expect(buildQuery({ q: "Łódź", limit: 3, missing: undefined })).toBe(
      "?q=%C5%81%C3%B3d%C5%BA&limit=3",
    );
    expect(buildQuery({ missing: undefined })).toBe("");
  });
});

describe("readTextSlice", () => {
  it("asks for a byte range and reports where the next slice starts", async () => {
    const fetch = stubRoutes({ "book.txt": { body: "", bytes: FAKE_TEXT_BYTES } });

    const slice = await readTextSlice(FILE_URL, { offset: 0, maxBytes: 16 });

    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("range")).toBe("bytes=0-15");
    expect(slice.offset).toBe(0);
    expect(slice.totalBytes).toBe(FAKE_TEXT_BYTES.byteLength);
    expect(slice.truncated).toBe(true);
    expect(slice.nextOffset).toBe(slice.offset + slice.bytes);
    // Sixteen bytes, not sixteen characters: "ł" costs two of them.
    expect(slice.text).toBe("Rozdział pierws");
    expect(slice.bytes).toBe(16);
  });

  it("never returns half a character", async () => {
    stubRoutes({ "book.txt": { body: "", bytes: FAKE_TEXT_BYTES } });

    const first = await readTextSlice(FILE_URL, { offset: 0, maxBytes: 8 });
    expect(first.text).not.toContain("�");
    expect(first.bytes).toBe(7);

    const second = await readTextSlice(FILE_URL, { offset: first.nextOffset ?? 0, maxBytes: 8 });
    expect(second.text).not.toContain("�");
    expect(second.text.startsWith("ł")).toBe(true);
  });

  it("reads a whole short file in one call and reports it as complete", async () => {
    stubRoutes({ "book.txt": { body: "", bytes: FAKE_TEXT_BYTES } });

    const slice = await readTextSlice(FILE_URL, { offset: 0, maxBytes: 4096 });

    expect(slice.text).toBe(FAKE_TEXT);
    expect(slice.truncated).toBe(false);
    expect(slice.nextOffset).toBeUndefined();
  });

  it("slices locally when the server ignores the range header", async () => {
    // A mirror or a proxy may answer 200 with the whole file; the caller asked for a page of it.
    const fetch = vi.fn(async () => new Response(FAKE_TEXT_BYTES as BodyInit, { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const slice = await readTextSlice(FILE_URL, { offset: 19, maxBytes: 12 });

    expect(slice.offset).toBe(19);
    expect(slice.bytes).toBeLessThanOrEqual(12);
    expect(slice.text).not.toContain("�");
    expect(FAKE_TEXT).toContain(slice.text);
  });

  it("normalizes a transport failure into the Books hierarchy", async () => {
    stubRoutes({ other: { body: {} } });
    await expect(readTextSlice(FILE_URL, { offset: 0, maxBytes: 10 })).rejects.toThrow(/Not found/);
  });
});
