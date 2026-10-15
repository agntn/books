/** Pi extension: Books - unified book catalog and public-domain full-text tools */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { registerPiTools, type PiRenderers } from "@agntn/tools/pi";

import type * as BookTools from "../../dist/tools.d.mts";
import type { OutputTheme, RenderedToolResult, RenderOptions } from "../shared/tui.ts";
import { renderToolResult } from "../shared/tui.ts";

const sourceModuleUrl = new URL("../../src/tools.ts", import.meta.url);
const distributionModuleUrl = new URL("../../dist/tools.mjs", import.meta.url);

/**
 * Render a finished call's output: the shared bounded preview, whole once expanded.
 *
 * @param result - Tool result.
 * @param options - Row view state.
 * @param theme - Host theme.
 * @returns {Text} The preview.
 */
function resultLine(result: RenderedToolResult, options: RenderOptions, theme: OutputTheme): Text {
  return new Text(renderToolResult(result, options, theme), 0, 0);
}

const preview: PiRenderers = { renderResult: resultLine };

/**
 * Registers the book tools shared with MCP, OMP and the AI SDK: the live source in a checkout,
 * the build in the package. The providers load on the first call.
 *
 * @param pi - Pi extension API.
 */
export default async function booksExtension(pi: ExtensionAPI): Promise<void> {
  const { bookTools } = (await import(
    existsSync(fileURLToPath(sourceModuleUrl)) ? sourceModuleUrl.href : distributionModuleUrl.href
  )) as typeof BookTools;
  registerPiTools(pi, bookTools, {
    renderers: Object.fromEntries(bookTools.map((tool) => [tool.name, preview])),
  });
}
