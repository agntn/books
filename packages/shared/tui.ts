import { stripVTControlCharacters } from "node:util";

/**
 * Collapsed result previews shared by the Pi and OMP wrappers.
 *
 * Without a result renderer both harnesses hand the whole tool output to one Text component,
 * which wraps every line in full. Book output is the shape that hurts: a `books_text` slice is
 * 32 KiB of prose by default, and a record's blurb arrives as a single line exactly as long as
 * the catalog wrote it. The collapsed view then wraps thousands of characters nobody asked to
 * read before the row is ever expanded.
 *
 * These renderers cut the preview to a fixed depth and width, count what they left out, and hand
 * back the full text once the row is expanded. Each wrapper adapts its own renderer signature
 * and calls in here, so both surfaces read the same.
 */

/**
 * The part of the harness theme this renderer touches. `fg` is optional: a harness may hand a
 * renderer a bare object, and unstyled output still has to read correctly.
 */
export interface OutputTheme {
  fg?(color: string, text: string): string;
}

/** View state of the result row, as both harnesses report it. */
export interface RenderOptions {
  expanded?: boolean;
}

/**
 * A tool result as the harness hands it back to the renderer.
 *
 * `content` stays untyped because a harness models it as a union of text and image parts, and an
 * image part shares no field with a text one.
 */
export interface RenderedToolResult {
  content?: ReadonlyArray<unknown>;
}

/** Lines the collapsed preview shows before it counts the rest. */
const COLLAPSED_BODY_LINES = 10;

/** Width one collapsed line gets before it is cut. */
const PREVIEW_LINE_WIDTH = 200;

/**
 * Text scanned per collapsed line. Sanitizing only shortens a line, so a lead this much wider
 * than the preview still fills it, and a paragraph the length of a chapter is never scanned
 * whole for a 200-character preview.
 */
const COLLAPSED_SCAN_WIDTH = 2048;

/** C0 and C1 bytes, which drive the terminal rather than print in it. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/** The first half of a surrogate pair, matched as one UTF-16 code unit. */
const HIGH_SURROGATE = /^[\uD800-\uDBFF]$/;

/**
 * Cut `text` to `end` code units without splitting a surrogate pair.
 *
 * Half a pair is not a character the terminal can measure or print, so a cut landing inside one
 * gives back the code unit before it. The unit is tested on its own: `codePointAt` would read a
 * high surrogate together with the low one after it and see a whole character.
 *
 * @param {string} text The line.
 * @param {number} end Code units to keep.
 * @returns {string} The cut line.
 */
function cutAt(text: string, end: number): string {
  return text.slice(0, HIGH_SURROGATE.test(text.slice(end - 1, end)) ? end - 1 : end);
}

/**
 * Strip everything that would drive the terminal instead of printing in it. Catalog records and
 * downloaded files carry whatever their publisher put there, so this renderer sanitizes exactly
 * like the harness fallback it replaces.
 *
 * @param {string} text Text from a tool result.
 * @returns {string} The text with escape sequences and control characters gone.
 */
function sanitize(text: string): string {
  return stripVTControlCharacters(text.toWellFormed()).replaceAll(CONTROL_CHARACTERS, " ");
}

/**
 * Cut one preview line to `max`, marking that the rest is still there.
 *
 * @param {string} text A sanitized line.
 * @param {number} max Width of the preview.
 * @returns {string} The line, ending in `…` when it was cut.
 */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${cutAt(text, max - 1)}…`;
}

/**
 * Sanitize one line of a collapsed preview and fit it to the preview width.
 *
 * @param {string} line A line of the result.
 * @returns {string} The preview line.
 */
function previewLine(line: string): string {
  const lead = line.length > COLLAPSED_SCAN_WIDTH ? cutAt(line, COLLAPSED_SCAN_WIDTH) : line;
  return clip(sanitize(lead), PREVIEW_LINE_WIDTH);
}

/**
 * Walk `body` line by line, materializing at most `max` of them.
 *
 * A slice of a book runs to hundreds of lines where the collapsed view shows ten, and a renderer
 * reruns on every streamed delta, so the hidden lines are counted rather than allocated.
 *
 * @param {string} body The result text.
 * @param {number} max Lines to keep.
 * @returns {{ lines: string[]; hidden: number }} The kept lines and the count of the rest.
 */
function takeLines(body: string, max: number): { lines: string[]; hidden: number } {
  const lines: string[] = [];
  let hidden = 0;
  let cursor = 0;

  while (cursor <= body.length) {
    const breakAt = body.indexOf("\n", cursor);
    const end = breakAt === -1 ? body.length : breakAt;
    if (lines.length < max) lines.push(body.slice(cursor, end));
    else hidden++;
    if (breakAt === -1) break;
    cursor = breakAt + 1;
  }

  return { lines, hidden };
}

/**
 * Join the text the tool returned, skipping parts that carry no text.
 *
 * The tail is trimmed because a slice ending in a line break would otherwise spend one of the
 * ten preview lines on an empty row.
 *
 * @param {RenderedToolResult} result The tool result.
 * @returns {string} The text parts joined by line breaks.
 */
function resultText(result: RenderedToolResult): string {
  const parts: string[] = [];
  for (const part of result.content ?? []) {
    if (typeof part !== "object" || part === null) continue;
    const text: unknown = Reflect.get(part, "text");
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("\n").trimEnd();
}

/**
 * Render a finished result: a bounded preview while the row is collapsed, the complete text once
 * it is expanded.
 *
 * @param {RenderedToolResult} result The tool result.
 * @param {RenderOptions} options Whether the row is expanded.
 * @param {OutputTheme} theme The host theme.
 * @returns {string} The rendered text.
 */
export function renderToolResult(
  result: RenderedToolResult,
  options: RenderOptions,
  theme: OutputTheme,
): string {
  const body = resultText(result);
  if (body.length === 0) return "";

  const paint = (color: string, text: string) => (theme.fg ? theme.fg(color, text) : text);
  const expanded = options.expanded === true;
  const { lines, hidden } = takeLines(
    body,
    expanded ? Number.POSITIVE_INFINITY : COLLAPSED_BODY_LINES,
  );

  const rendered = lines.map((line) =>
    paint("toolOutput", expanded ? sanitize(line) : previewLine(line)),
  );
  if (hidden > 0) rendered.push(paint("muted", `… ${hidden} more lines`));

  return rendered.join("\n");
}
