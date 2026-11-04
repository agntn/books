import oxfmt from "@agntn/ox/oxfmt";
import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "vite-plus";

const readonlyParams = oxlint.rules?.["typescript/prefer-readonly-parameter-types"];
if (!Array.isArray(readonlyParams)) {
  throw new TypeError("@agntn/ox no longer configures typescript/prefer-readonly-parameter-types");
}
const [severity, options] = readonlyParams;

/** Lint, format and test run on Vite+; the build stays on obuild (`build.config.ts`). */
export default defineConfig({
  fmt: { ...oxfmt, ignorePatterns: ["dist"] },
  lint: {
    ...oxlint,
    rules: {
      ...oxlint.rules,
      "typescript/prefer-readonly-parameter-types": [
        severity,
        {
          ...options,
          allow: [
            ...(options?.allow ?? []),
            /** Public types and the Pi/OMP renderer ABI only; an internal type gets `readonly`. */
            {
              from: "file",
              name: [
                "Book",
                "BookMatch",
                "BookQuery",
                "BookText",
                "BooksError",
                "FallbackResult",
                "OutputTheme",
                "Provider",
                "ProviderConfig",
                "ProviderListing",
                "ProviderOutcome",
                "RenderOptions",
                "RenderedToolResult",
                "SearchOptions",
                "TextFollowOptions",
                "TextFollowResult",
                "TextMatch",
                "TextOptions",
                "TextSearchOptions",
                "TextSearchResult",
              ],
            },
            /** Lib types the rule reads as mutable whatever wraps them. */
            {
              from: "lib",
              name: [
                "AbortSignal",
                "Headers",
                "ReadonlyMap",
                "Request",
                "RequestInit",
                "Response",
                "URL",
                "Uint8Array",
              ],
            },
            /** A Pi tool as the extension registers it. */
            {
              from: "package",
              name: "ToolDefinition",
              package: "@earendil-works/pi-coding-agent",
            },
            /** `HTMLElement`, the page the HTML providers query, exported as `default`. */
            { from: "package", name: "default", package: "node-html-parser" },
          ],
        },
      ],
    },
    ignorePatterns: ["dist"],
  },
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
