/** OMP extension: Books - unified book catalog and public-domain full-text tools. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Text } from "@oh-my-pi/pi-coding-agent";
import { renderStatusLine } from "@oh-my-pi/pi-coding-agent/tui";

import type * as BooksModule from "../../../dist/index.d.mts";
import type { OutputTheme, RenderedToolResult, RenderOptions } from "../../shared/tui.ts";
import { renderToolResult } from "../../shared/tui.ts";

const sourceModulePath = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));
let booksModulePromise: Promise<typeof BooksModule> | undefined;

/**
 * Load current source in development and fall back to the built package in distributions.
 *
 * Both specifiers stay literal: OMP rewrites bare dependencies only for imports it can see
 * statically. existsSync chooses the branch; it does not build a URL for a single import().
 */
function loadLibrary(): Promise<typeof BooksModule> {
  booksModulePromise ??= existsSync(sourceModulePath)
    ? (import("../../../src/index.ts") as unknown as Promise<typeof BooksModule>)
    : (import("../../../dist/index.mjs") as Promise<typeof BooksModule>);

  return booksModulePromise;
}

/**
 * Renderer interpolations cross the terminal trust boundary: model arguments and catalog text
 * may carry ANSI/OSC escape sequences or raw control bytes that OMP's Text component passes to
 * the terminal unchanged. String() first, because hostile JSON is not bound by the declared
 * parameter types.
 */
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const SPACE_RUNS = / +/g;

export function sanitizeTerminalText(value: unknown): string {
  return stripVTControlCharacters(String(value))
    .replace(CONTROL_CHARACTERS, " ")
    .replace(SPACE_RUNS, " ")
    .trim();
}

/**
 * Sanitize multi-line tool output while keeping its line structure.
 *
 * A book's text is the point of one of these tools, and its line breaks carry meaning, so
 * control bytes are removed per line rather than by a regex that would have to spare `\n`.
 */
function sanitizeTerminalBlock(text: string): string {
  return stripVTControlCharacters(text)
    .split("\n")
    .map((line) => line.replace(CONTROL_CHARACTERS, " "))
    .join("\n");
}

type BooksToolResult = AgentToolResult<undefined>;

function textResult(text: string): BooksToolResult {
  return {
    content: [{ type: "text", text: sanitizeTerminalBlock(text) }],
    details: undefined,
  };
}

/** Render a finished call's output: the shared bounded preview, whole once expanded. */
function resultLine(result: RenderedToolResult, options: RenderOptions, theme: OutputTheme): Text {
  return new Text(renderToolResult(result, options, theme), 0, 0);
}

/** Label a lookup by whatever the caller used to name the book. */
function describeQuery(args: { isbn?: unknown; title?: unknown; id?: unknown }): string {
  return String(args.isbn ?? args.title ?? args.id ?? "book");
}

/**
 * Register Books tools with the OMP extension host.
 *
 * OMP validates tool parameters with its own TypeBox build, so schemas must come from the
 * host-injected facade rather than a standalone typebox import.
 */
export default function booksExtension(pi: ExtensionAPI): void {
  const { Type } = pi.typebox;
  pi.setLabel("Books");

  type RenderCallOptions = { isPartial?: boolean; spinnerFrame?: number };
  type RenderTheme = Parameters<typeof renderStatusLine>[1];

  function statusLine(
    title: string,
    description: string,
    options: RenderCallOptions,
    theme: RenderTheme,
  ): Text {
    const icon = options.isPartial
      ? options.spinnerFrame === undefined
        ? "pending"
        : "running"
      : "done";

    return new Text(
      renderStatusLine(
        {
          icon,
          spinnerFrame: options.spinnerFrame,
          title,
          description: sanitizeTerminalText(description),
        },
        theme,
      ),
      0,
      0,
    );
  }

  const providerParameter = Type.Optional(
    Type.String({
      description:
        "Registered provider key, or 'all' to compare every provider; use books_providers to list them",
      minLength: 1,
    }),
  );
  const titleParameter = Type.Optional(Type.String({ description: "Book title", minLength: 1 }));
  const authorParameter = Type.Optional(
    Type.String({
      description: "Author, to sharpen a title match; never enough on its own",
      minLength: 1,
    }),
  );
  const bookIdParameter = Type.Optional(
    Type.String({
      description: "Provider-native book id from a previous books_search on that provider",
      minLength: 1,
      maxLength: 200,
    }),
  );

  pi.registerTool({
    name: "books_get",
    label: "Books Get",
    description:
      "Fetch the bibliographic record of one book by ISBN, title, or provider id. Without a provider, catalogs are tried in order until one has it; an ISBN only reaches catalogs that can look one up.",
    parameters: Type.Object({
      isbn: Type.Optional(
        Type.String({
          description: "ISBN-10 or ISBN-13; hyphens are ignored and the check digit is verified",
          minLength: 10,
          maxLength: 20,
        }),
      ),
      title: titleParameter,
      author: authorParameter,
      id: bookIdParameter,
      provider: providerParameter,
    }),
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Books Get", describeQuery(args), options, theme);
    },
    renderResult: resultLine,
    async execute(_toolCallId, params): Promise<BooksToolResult> {
      const lib = await loadLibrary();
      const query = {
        isbn: params.isbn,
        title: params.title,
        author: params.author,
        id: params.id,
      };

      if (lib.isAllProviders(params.provider)) {
        return textResult(lib.formatBookAll(await lib.bookAll(query)));
      }
      if (lib.providerArg(params.provider)) {
        const { provider } = lib.selectProvider(params.provider);
        return textResult(lib.formatBook(await lib.requireOperation(provider, "book")(query)));
      }
      return textResult(lib.formatFallback(await lib.bookWithFallback(query), lib.formatBook));
    },
  });

  pi.registerTool({
    name: "books_search",
    label: "Books Search",
    description:
      "Find books matching a free-form query. Returns candidates with year, ISBN and the provider-native id to pass back to books_get or books_text.",
    parameters: Type.Object({
      query: Type.String({
        description: "Free-form query, for example 'dune frank herbert'",
        minLength: 1,
      }),
      limit: Type.Optional(
        Type.Integer({ description: "Maximum number of results", minimum: 1, maximum: 50 }),
      ),
      provider: providerParameter,
    }),
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Books Search", String(args.query), options, theme);
    },
    renderResult: resultLine,
    async execute(_toolCallId, params): Promise<BooksToolResult> {
      const lib = await loadLibrary();
      const options = { limit: params.limit };
      if (lib.isAllProviders(params.provider)) {
        return textResult(
          lib.formatSearchAll(params.query, await lib.searchAll(params.query, options)),
        );
      }
      const { name, provider } = lib.selectProvider(params.provider, "search");
      const search = lib.requireOperation(provider, "search");
      return textResult(lib.formatBooks(name, params.query, await search(params.query, options)));
    },
  });

  pi.registerTool({
    name: "books_text",
    label: "Books Text",
    description:
      "Read a slice of a public-domain book's text. Only Project Gutenberg (English) and Wolne Lektury (Polish) serve texts; the result carries nextOffset for reading on.",
    parameters: Type.Object({
      title: titleParameter,
      author: authorParameter,
      id: bookIdParameter,
      offset: Type.Optional(
        Type.Integer({
          description: "Byte offset to start reading at; use nextOffset from the previous slice",
          minimum: 0,
        }),
      ),
      maxBytes: Type.Optional(
        Type.Integer({
          description: "Maximum bytes to read in one call; defaults to 32768",
          minimum: 1,
          maximum: 262_144,
        }),
      ),
      provider: providerParameter,
    }),
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Books Text", describeQuery(args), options, theme);
    },
    renderResult: resultLine,
    async execute(_toolCallId, params): Promise<BooksToolResult> {
      const lib = await loadLibrary();
      const query = { title: params.title, author: params.author, id: params.id };
      const options = { offset: params.offset, maxBytes: params.maxBytes };

      if (lib.providerArg(params.provider)) {
        const { provider } = lib.selectProvider(params.provider, "text");
        const text = lib.requireOperation(provider, "text");
        return textResult(lib.formatText(await text(query, options)));
      }
      return textResult(
        lib.formatFallback(await lib.textWithFallback(query, options), lib.formatText),
      );
    },
  });

  pi.registerTool({
    name: "books_providers",
    label: "Books Providers",
    description:
      "List registered book providers: which catalogs search, resolve an ISBN, carry full texts or carry reader ratings.",
    parameters: Type.Object({}),
    approval: "read",
    renderCall(_args, options, theme) {
      return statusLine("Books Providers", "registered catalogs", options, theme);
    },
    renderResult: resultLine,
    async execute(): Promise<BooksToolResult> {
      const lib = await loadLibrary();
      return textResult(lib.formatProviders(lib.listProviders()));
    },
  });
}
