import { describe, expect, it } from "vitest";
import { normalizeText, parseYear, trimPartialUtf8, uniqueStrings } from "../../src/core/text.ts";
import { FAKE_TEXT_BYTES } from "../helpers.ts";

describe("normalizeText", () => {
  it("normalizes line endings and trims trailing space", () => {
    expect(normalizeText("one\r\ntwo   \r\n\r\n")).toBe("one\ntwo");
  });
});

describe("parseYear", () => {
  it("reads a year out of the shapes cataloguers use", () => {
    expect(parseYear("1965")).toBe(1965);
    expect(parseYear("August 2, 2005")).toBe(2005);
    expect(parseYear("2014-01-01")).toBe(2014);
    expect(parseYear("copyright 1995.")).toBe(1995);
  });

  it("passes an integer through and refuses everything else", () => {
    expect(parseYear(1890)).toBe(1890);
    expect(parseYear(undefined)).toBeUndefined();
    expect(parseYear("no date")).toBeUndefined();
    expect(parseYear("s. 295")).toBeUndefined();
  });
});

describe("uniqueStrings", () => {
  it("trims, drops blanks and keeps first-seen order", () => {
    expect(uniqueStrings([" Prus ", undefined, "", "Prus", "Sienkiewicz"])).toEqual([
      "Prus",
      "Sienkiewicz",
    ]);
  });
});

describe("trimPartialUtf8", () => {
  const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

  it("leaves a whole range untouched", () => {
    const trimmed = trimPartialUtf8(FAKE_TEXT_BYTES, { start: false, end: false });
    expect(trimmed.leading).toBe(0);
    expect(trimmed.trailing).toBe(0);
    expect(decode(trimmed.bytes)).toContain("Łódź");
  });

  it("drops the tail of a character the previous slice opened", () => {
    // "Rozdzia" is 7 bytes; "ł" occupies bytes 7 and 8, so a slice starting at 8 opens on a
    // continuation byte that decodes to a replacement character on its own.
    const chunk = FAKE_TEXT_BYTES.subarray(8, 20);
    expect(decode(chunk).startsWith("�")).toBe(true);

    const trimmed = trimPartialUtf8(chunk, { start: true, end: false });
    expect(trimmed.leading).toBe(1);
    expect(decode(trimmed.bytes)).toBe(decode(FAKE_TEXT_BYTES.subarray(9, 20)));
    expect(decode(trimmed.bytes)).not.toContain("�");
  });

  it("drops the head of a character the next slice completes", () => {
    // The slice ends on the first byte of "ł".
    const chunk = FAKE_TEXT_BYTES.subarray(0, 8);
    expect(decode(chunk).endsWith("�")).toBe(true);

    const trimmed = trimPartialUtf8(chunk, { start: false, end: true });
    expect(trimmed.trailing).toBe(1);
    expect(decode(trimmed.bytes)).toBe("Rozdzia");
  });

  it("reports the bytes each end gave up, so offsets stay addable", () => {
    const chunk = FAKE_TEXT_BYTES.subarray(8, 27);
    const trimmed = trimPartialUtf8(chunk, { start: true, end: true });
    expect(trimmed.leading + trimmed.bytes.byteLength + trimmed.trailing).toBe(chunk.byteLength);
    expect(decode(trimmed.bytes)).not.toContain("�");
  });

  it("survives a range made entirely of continuation bytes", () => {
    const trimmed = trimPartialUtf8(FAKE_TEXT_BYTES.subarray(8, 9), { start: true, end: true });
    expect(trimmed.bytes.byteLength).toBe(0);
  });
});
