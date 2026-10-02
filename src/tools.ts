/**
 * The book tools, declared once for MCP, Pi, OMP and the AI SDK.
 *
 * The executors load on the first call, not with this module: the Pi and OMP extensions import it
 * at startup to register the tools, and the providers are most of the package.
 *
 * `Type` comes from `@agntn/tools`, not `typebox`: OMP rewrites a bare `typebox` import to its
 * omptype facade, whose schemas are functions instead of JSON Schema.
 */

import { defineTool, Type, type ToolDefinition } from "@agntn/tools";

import { MAX_TEXT_BYTES } from "./core/types.ts";

let operations: Promise<typeof import("./tool-operations.ts")> | undefined;

/**
 * Loads the executors once. A failed load isn't cached, so a broken `dist` doesn't stick.
 *
 * @returns {Promise<typeof import("./tool-operations.ts")>} The executors.
 */
function loadOperations(): Promise<typeof import("./tool-operations.ts")> {
  operations ??= import("./tool-operations.ts").catch((error: unknown) => {
    operations = undefined;
    throw error;
  });
  return operations;
}

/** Optional text takes "" as absent, so a host filling every field with "" isn't refused. */
const provider = Type.Optional(
  Type.String({
    maxLength: 64,
    description:
      "Registered provider key, or 'all' to compare every provider; use books_providers to list them. Empty or omitted: catalogs are tried in order",
  }),
);
const title = Type.Optional(Type.String({ maxLength: 500, description: "Book title" }));
const author = Type.Optional(
  Type.String({
    maxLength: 200,
    description: "Author, to sharpen a title match; never enough on its own",
  }),
);
const id = Type.Optional(
  Type.String({
    maxLength: 200,
    description: "Provider-native book id from a previous books_search on that provider",
  }),
);

export const providersTool = defineTool({
  name: "books_providers",
  title: "Books Providers",
  description:
    "List registered book providers: which catalogs search, resolve an ISBN, carry full texts or carry reader ratings, and whether each one's credential is set.",
  snippet: "Use books_providers to check which book catalogs are available.",
  guidelines: [
    "Use books_providers to list provider keys and their capabilities: which catalogs search, which resolve an ISBN, which carry full texts and which carry reader ratings.",
  ],
  effect: "read",
  input: Type.Object({}),
  execute: async () => (await loadOperations()).booksProviders(),
});

export const searchTool = defineTool({
  name: "books_search",
  title: "Books Search",
  description:
    "Find books matching a free-form query, best match first. Returns candidates with year, ISBN and the provider-native id to pass back to books_get or books_text. Pass provider 'all' to compare every catalog.",
  snippet: "Use books_search to find the exact title, author and id of a book.",
  guidelines: [
    "Use books_search when the title or author spelling is uncertain; it returns candidates with year, ISBN and provider id.",
    "Feed the id from books_search into books_get or books_text with the same provider for an exact lookup.",
  ],
  effect: "read",
  openWorld: true,
  input: Type.Object(
    {
      query: Type.String({
        minLength: 1,
        maxLength: 500,
        pattern: "\\S",
        description: "Free-form query, for example 'dune frank herbert'",
      }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 50,
          description: "Max results; providers cap this at 10-20 and silently truncate",
        }),
      ),
      provider,
    },
    { additionalProperties: false },
  ),
  execute: async (params) => (await loadOperations()).booksSearch(params),
});

export const getTool = defineTool({
  name: "books_get",
  title: "Books Get",
  description:
    "Fetch the bibliographic record of one book by ISBN, title, or provider id. Without a provider, catalogs are tried in order until one has it; an ISBN only reaches catalogs that can look one up. Pass provider 'all' to compare what each catalog holds.",
  snippet: "Use books_get to look a book up by ISBN, title, or catalog id.",
  guidelines: [
    "Use books_get with an isbn when you have one - it is the only identifier that means the same book in every catalog.",
    "Without a provider, books_get walks catalogs until one has the book; an ISBN only reaches catalogs that can look one up.",
    "Pass provider 'all' to books_get to compare what each catalog holds: page counts, years and even titles differ between editions.",
    "Every books_get record carries the source URL - cite it rather than presenting merged catalog data as one fact.",
  ],
  effect: "read",
  openWorld: true,
  input: Type.Object(
    {
      isbn: Type.Optional(
        Type.String({
          maxLength: 20,
          description: "ISBN-10 or ISBN-13; hyphens are ignored and the check digit is verified",
        }),
      ),
      title,
      author,
      id,
      provider,
    },
    { additionalProperties: false },
  ),
  execute: async (params) => (await loadOperations()).booksGet(params),
});

export const textTool = defineTool({
  name: "books_text",
  title: "Books Text",
  description:
    "Read a slice of a public-domain book's text, by title or provider id. Only Project Gutenberg (English) and Wolne Lektury (Polish) serve texts; the result carries nextOffset for reading on.",
  snippet: "Use books_text to read the actual text of a book that is out of copyright.",
  guidelines: [
    "books_text only reaches the public-domain libraries: Project Gutenberg for English and Wolne Lektury for Polish. Books still in copyright are not there and no catalog will serve them.",
    "One books_text call returns a slice, not a book. Read on by passing the nextOffset from the previous result as offset.",
    "Raise the books_text maxBytes only when the task needs a long passage - the text lands in the conversation whole.",
  ],
  effect: "read",
  openWorld: true,
  input: Type.Object(
    {
      title,
      author,
      id,
      offset: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: "Byte offset to start reading at; use nextOffset from the previous slice",
        }),
      ),
      maxBytes: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_TEXT_BYTES,
          description: `Max bytes to read in one call, up to ${MAX_TEXT_BYTES}; defaults to 32768`,
        }),
      ),
      provider,
    },
    { additionalProperties: false },
  ),
  execute: async (params) => (await loadOperations()).booksText(params),
});

/** The four book tools, discovery first. */
export const bookTools: readonly ToolDefinition[] = [providersTool, searchTool, getTool, textTool];
