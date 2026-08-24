import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQuery, readTextSlice } from "../../src/core/client.ts";
import { FAKE_TEXT, FAKE_TEXT_BYTES } from "../helpers.ts";
import { stubRoutes } from "../helpers.ts";

const FILE_URL = "https://example.test/book.txt";

afterEach(() => {
  vi.unstubAllGlobals();
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
