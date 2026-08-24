/** Local text transformations: no provider, no network. */

/** Normalize line endings and strip the blank lines a file or a blurb ends with. */
export function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * First four-digit year in a date string, or `undefined` when it carries none.
 *
 * The catalogs print publication dates every way a cataloguer ever has: `1965`, `2005`,
 * `August 2, 2005`, `2014-01-01`, `[ca 1995]`. Only the year is portable, so only the year is
 * kept, and the provider's own spelling stays in `Book.published`.
 */
export function parseYear(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  const year = value.match(/\b(1\d{3}|20\d{2}|2100)\b/)?.[1];
  return year ? Number(year) : undefined;
}

/** Trim, drop blanks, and remove duplicates while keeping first-seen order. */
export function uniqueStrings(values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

const CONTINUATION_MASK = 0b1100_0000;
const CONTINUATION_BITS = 0b1000_0000;

/** True for a byte that continues a multi-byte UTF-8 sequence rather than opening one. */
function isContinuation(byte: number): boolean {
  return (byte & CONTINUATION_MASK) === CONTINUATION_BITS;
}

/** Length of the sequence a leading byte opens, or 0 when the byte does not open one. */
function sequenceLength(byte: number): number {
  if (byte < 0x80) return 1;
  if ((byte & 0b1110_0000) === 0b1100_0000) return 2;
  if ((byte & 0b1111_0000) === 0b1110_0000) return 3;
  if ((byte & 0b1111_1000) === 0b1111_0000) return 4;
  return 0;
}

/** A byte range cut back to whole UTF-8 characters, with the bytes each end gave up. */
export interface TrimmedBytes {
  /** The bytes that decode cleanly */
  bytes: Uint8Array;
  /** Bytes dropped from the front - the tail of a character the previous slice opened */
  leading: number;
  /** Bytes dropped from the back - the head of a character the next slice completes */
  trailing: number;
}

/**
 * Cut a byte range back to whole UTF-8 characters.
 *
 * An HTTP byte range lands wherever the arithmetic puts it, which for any text with accented
 * characters is regularly in the middle of one: half of `ł` decodes to `�`, and two
 * adjacent slices would each show a replacement character where the reader expects a letter.
 *
 * `start` and `end` say which ends may hold a partial character: the first slice of a file has
 * nothing before it, and a slice that reached the end of the file has nothing after it.
 *
 * A character is at most four bytes, so at most three continuation bytes can precede a leading
 * one. A longer run is malformed input, not a cut character, and is left alone.
 */
export function trimPartialUtf8(
  bytes: Uint8Array,
  options: { start?: boolean; end?: boolean } = {},
): TrimmedBytes {
  let from = 0;
  if (options.start) {
    while (from < bytes.byteLength && from < 3 && isContinuation(bytes[from] ?? 0)) from++;
  }

  let to = bytes.byteLength;
  if (options.end) {
    let lead = to - 1;
    while (lead >= from && lead >= to - 4 && isContinuation(bytes[lead] ?? 0)) lead--;
    if (lead >= from) {
      const needed = sequenceLength(bytes[lead] ?? 0);
      if (needed === 0 || lead + needed > to) to = lead;
    }
  }

  return {
    bytes: bytes.subarray(from, Math.max(from, to)),
    leading: from,
    trailing: bytes.byteLength - Math.max(from, to),
  };
}
