/** Local text transformations: no provider, no network. */

/**
 * Normalize line endings and strip the blank lines a file or a blurb ends with.
 *
 * @param {string} value Text as a provider served it.
 * @returns {string} The text with `\n` line endings and no trailing blanks.
 */
export function normalizeText(value: string): string {
  return value
    .replaceAll(/\r\n?/g, "\n")
    .replaceAll(/[ \t]+$/gm, "")
    .trim();
}

/**
 * First four-digit year in a date string, or `undefined` when it carries none.
 *
 * The catalogs print publication dates every way a cataloguer ever has: `1965`, `2005`,
 * `August 2, 2005`, `2014-01-01`, `[ca 1995]`. Only the year is portable, so only the year is
 * kept, and the provider's own spelling stays in `Book.published`.
 *
 * @param {string | number | undefined} value Date as the catalog printed it.
 * @returns {number | undefined} The year, or `undefined` when there's none.
 */
export function parseYear(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  const year = value.match(/\b(1\d{3}|20\d{2}|2100)\b/)?.[1];
  return year ? Number(year) : undefined;
}

/**
 * Trim, drop blanks, and remove duplicates while keeping first-seen order.
 *
 * @param {readonly (string | undefined)[]} values Strings to clean up.
 * @returns {string[]} The distinct non-blank strings.
 */
export function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

const CONTINUATION_MASK = 0b1100_0000;
const CONTINUATION_BITS = 0b1000_0000;

/**
 * True for a byte that continues a multi-byte UTF-8 sequence rather than opening one.
 *
 * @param {number} byte One byte of the range.
 * @returns {boolean} Whether the byte is a continuation byte.
 */
function isContinuation(byte: number): boolean {
  return (byte & CONTINUATION_MASK) === CONTINUATION_BITS;
}

/**
 * Length of the sequence a leading byte opens.
 *
 * @param {number} byte A byte that should open a character.
 * @returns {number} The sequence length, or 0 when the byte doesn't open one.
 */
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
 * Count the continuation bytes a range opens with, at most three.
 *
 * @param {Uint8Array} bytes The byte range.
 * @returns {number} Where the first whole character starts.
 */
function firstWhole(bytes: Uint8Array): number {
  let from = 0;
  while (from < bytes.byteLength && from < 3 && isContinuation(bytes[from] ?? 0)) from++;
  return from;
}

/**
 * Find where the last whole character ends.
 *
 * @param {Uint8Array} bytes The byte range.
 * @param {number} from Where the first whole character starts.
 * @returns {number} The end of the last whole character.
 */
function lastWhole(bytes: Uint8Array, from: number): number {
  const to = bytes.byteLength;
  let lead = to - 1;
  while (lead >= from && lead >= to - 4 && isContinuation(bytes[lead] ?? 0)) lead--;
  if (lead < from) return to;
  const needed = sequenceLength(bytes[lead] ?? 0);
  return needed === 0 || lead + needed > to ? lead : to;
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
 *
 * @param {Uint8Array} bytes The byte range as the server sent it.
 * @param {Readonly<{ start?: boolean; end?: boolean }>} options Which ends may be cut.
 * @returns {TrimmedBytes} The whole characters and the bytes each end gave up.
 */
export function trimPartialUtf8(
  bytes: Uint8Array,
  options: Readonly<{ start?: boolean; end?: boolean }> = {},
): TrimmedBytes {
  const from = options.start ? firstWhole(bytes) : 0;
  const to = options.end ? lastWhole(bytes, from) : bytes.byteLength;
  return {
    bytes: bytes.subarray(from, Math.max(from, to)),
    leading: from,
    trailing: bytes.byteLength - Math.max(from, to),
  };
}
