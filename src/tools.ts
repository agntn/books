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

import {
  DEFAULT_ANCHOR_WORDS,
  DEFAULT_FOLLOW_STEPS,
  MAX_ANCHOR_WORDS,
  MAX_FOLLOW_STEPS,
  MAX_TEXT_BYTES,
  MAX_TEXT_SEARCH_PAGES,
  MIN_ANCHOR_WORDS,
} from "./core/types.ts";

let operations: Promise<typeof import("./tool-operations.ts")> | undefined;

/**
 * Loads the executors once. A failed load isn't cached, so a broken `dist` doesn't stick.
 *
 * @returns {Promise<typeof import("./tool-operations.ts")>} The executors.
 */
export function loadOperations(): Promise<typeof import("./tool-operations.ts")> {
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
  cli: { description: "List registered book providers and capabilities" },
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
  cli: { description: "Search providers for books matching a query", positional: ["query"] },
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
      provider: Type.Optional(
        Type.String({
          maxLength: 64,
          description:
            "Registered provider key; use books_providers to list them. Empty or omitted: the libraries that carry texts are tried in order",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  execute: async (params) => (await loadOperations()).booksText(params),
});

export const textSearchTool = defineTool({
  name: "books_text_search",
  title: "Books Text Search",
  description:
    "Find a phrase inside scanned books, lending-only ones included, and return the short passages around each match with the scan id, page and reader link. Only Open Library serves it. Pass a scan id as book to keep one book's passages; nextPage reads on.",
  snippet:
    "Use books_text_search to find a phrase inside a scanned book that books_text cannot read.",
  guidelines: [
    "books_text_search matches its query as a phrase: every word has to stand next to the others in the scan. Search for a few distinctive words, not a sentence.",
    "Pass the id of a books_text_search match as book to keep only that scan's passages. The search ranks the whole corpus, so a common phrase can bury the book past maxPages, while a rarer phrase from the same book finds it on the first page.",
    "A books_text_search passage is about a dozen words of OCR text. To read on through the same scan, call books_text_follow with the phrase and the scan id.",
  ],
  effect: "read",
  openWorld: true,
  input: Type.Object(
    {
      query: Type.String({
        minLength: 1,
        maxLength: 500,
        pattern: "\\S",
        description: "Phrase to find, for example 'the spice must flow'",
      }),
      book: Type.Optional(
        Type.String({
          maxLength: 200,
          description: "Scan id from a previous match; only that book's passages are returned",
        }),
      ),
      page: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: "Page of hits to start at; use nextPage from the previous result",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 100,
          description: "Hits on one page; defaults to 20, or 100 with book. Keep it when paging",
        }),
      ),
      maxPages: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_TEXT_SEARCH_PAGES,
          description: `Pages to read while looking for book, up to ${MAX_TEXT_SEARCH_PAGES}; defaults to 3. Each can take ten seconds`,
        }),
      ),
      provider: Type.Optional(
        Type.String({
          maxLength: 64,
          description:
            "Registered provider key; use books_providers to list them. Empty or omitted: the first that searches inside scans",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: {
    command: "search-text",
    description: "Find a phrase inside scanned books and print the passages around it",
    positional: ["query"],
  },
  execute: async (params) => (await loadOperations()).booksTextSearch(params),
});

export const textFollowTool = defineTool({
  name: "books_text_follow",
  title: "Books Text Follow",
  description: `Read on through one scanned book from a phrase. Each search starts from the last words read so far (the first ones with backward) and adds the next few. Only Open Library serves it. A search can take half a minute, so one call runs ${DEFAULT_FOLLOW_STEPS} searches unless steps says more. The result ends with the query that reads on from where it stopped.`,
  snippet:
    "Use books_text_follow to read a paragraph of a scanned book that books_text cannot read.",
  guidelines: [
    "books_text_follow needs a scan id from books_text_search as book, and a phrase that search found in it as query.",
    "To read further than one books_text_follow call, call it again with the query its result ends with, the same book and the same backward value.",
    "When books_text_follow loses the book or the passage drifts into a caption or a quotation many books share, restart it from a distinctive phrase of the main text further along, or read backward from a later sentence to recover the skipped part.",
  ],
  effect: "read",
  openWorld: true,
  input: Type.Object(
    {
      query: Type.String({
        minLength: 1,
        maxLength: 500,
        pattern: "\\S",
        description:
          "Phrase found in the book to start from, or the query a previous result ends with",
      }),
      book: Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: "\\S",
        description: "Scan id from a books_text_search match; the chain reads only this book",
      }),
      backward: Type.Optional(
        Type.Boolean({
          description: "Read back before the phrase instead of on past it",
        }),
      ),
      steps: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_FOLLOW_STEPS,
          description: `Searches to run, the first one included; defaults to ${DEFAULT_FOLLOW_STEPS}. Each adds about five words and can take half a minute`,
        }),
      ),
      anchorWords: Type.Optional(
        Type.Integer({
          minimum: MIN_ANCHOR_WORDS,
          maximum: MAX_ANCHOR_WORDS,
          description: `Words each next search starts from; defaults to ${DEFAULT_ANCHOR_WORDS}. Fewer words match more books and can bury this one`,
        }),
      ),
      maxPages: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_TEXT_SEARCH_PAGES,
          description: `Pages of 100 hits each search reads while looking for book, up to ${MAX_TEXT_SEARCH_PAGES}; defaults to 1`,
        }),
      ),
      provider: Type.Optional(
        Type.String({
          maxLength: 64,
          description:
            "Registered provider key; use books_providers to list them. Empty or omitted: the first that searches inside scans",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: {
    command: "follow-text",
    description: "Read on through a scanned book from a phrase, one search at a time",
    positional: ["query"],
  },
  execute: async (params) => (await loadOperations()).booksTextFollow(params),
});

/** The book tools, discovery first. */
export const bookTools: readonly ToolDefinition[] = [
  providersTool,
  searchTool,
  getTool,
  textTool,
  textSearchTool,
  textFollowTool,
];
