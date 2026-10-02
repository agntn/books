/** OMP extension: Books - unified book catalog and public-domain full-text tools. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerOmpTools, type OmpRenderers } from "@agntn/tools/omp";

import type * as BookTools from "../../../dist/tools.d.mts";
import type { OutputTheme, RenderedToolResult, RenderOptions } from "../../shared/tui.ts";
import { renderToolResult } from "../../shared/tui.ts";

/** Longest status line argument, cut before `sanitizeLine`, which is slow on long escapes. */
const PREVIEW_LENGTH = 100;

const sourceModulePath = fileURLToPath(new URL("../../../src/tools.ts", import.meta.url));

/**
 * Loads the book tool definitions shared with MCP, Pi and the AI SDK.
 *
 * Both specifiers stay literal: OMP rewrites bare dependencies only for imports it can see
 * statically. existsSync chooses the branch; it does not build a URL for a single import().
 *
 * @returns {Promise<typeof BookTools>} The tool definitions.
 */
function loadTools(): Promise<typeof BookTools> {
  return (
    existsSync(sourceModulePath)
      ? import("../../../src/tools.ts")
      : import("../../../dist/tools.mjs")
  ) as Promise<typeof BookTools>;
}

/**
 * Label a call by whatever the caller used to name the book.
 *
 * @param args - Call arguments.
 * @returns {string} The ISBN, title, id or query, or "book".
 */
function describeQuery(args: Readonly<Record<string, unknown>>): string {
  const named = [args.query, args.isbn, args.title, args.id].find(
    (value): value is string | number =>
      (typeof value === "string" || typeof value === "number") && Boolean(value),
  );
  return String(named ?? "book").slice(0, PREVIEW_LENGTH);
}

/**
 * Registers the book tools with `Text` from the host API, since compiled OMP injects no `/tui`.
 *
 * @param pi - OMP extension API.
 */
export default async function booksExtension(pi: ExtensionAPI): Promise<void> {
  const { Text } = pi.pi;

  /**
   * Render a finished call's output: the shared bounded preview, whole once expanded.
   *
   * @param result - Tool result.
   * @param options - Row view state.
   * @param theme - Host theme.
   * @returns {InstanceType<typeof Text>} The preview.
   */
  function resultLine(
    result: RenderedToolResult,
    options: RenderOptions,
    theme: OutputTheme,
  ): InstanceType<typeof Text> {
    return new Text(renderToolResult(result, options, theme), 0, 0);
  }

  const renderers: Readonly<Record<string, OmpRenderers>> = {
    books_providers: { describeCall: () => "registered catalogs", renderResult: resultLine },
    books_search: { describeCall: describeQuery, renderResult: resultLine },
    books_get: { describeCall: describeQuery, renderResult: resultLine },
    books_text: { describeCall: describeQuery, renderResult: resultLine },
    books_text_search: { describeCall: describeQuery, renderResult: resultLine },
    books_text_follow: { describeCall: describeQuery, renderResult: resultLine },
  };

  pi.setLabel("Books");
  const { bookTools } = await loadTools();
  registerOmpTools(pi, bookTools, { Text, renderers });
}
