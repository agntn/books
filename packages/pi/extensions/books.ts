/** Pi extension: Books - unified book catalog and public-domain full-text tools */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type * as BooksModule from "../../../dist/index.d.mts";

const sourceModuleUrl = new URL("../../../src/index.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/index.mjs", import.meta.url);
let booksModulePromise: Promise<typeof BooksModule> | undefined;

/** Load current source in development and fall back to the built package in distributions. */
function loadLibrary(): Promise<typeof BooksModule> {
  booksModulePromise ??= import(
    existsSync(fileURLToPath(sourceModuleUrl)) ? sourceModuleUrl.href : distributionModuleUrl.href
  ) as Promise<typeof BooksModule>;

  return booksModulePromise;
}

type BooksToolResult = AgentToolResult<undefined>;

function textResult(text: string): BooksToolResult {
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
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

export default function booksExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "books_get",
    label: "Books Get",
    description: "Fetch the bibliographic record of one book from a catalog",
    promptSnippet: "Use books_get to look a book up by ISBN, title, or catalog id.",
    promptGuidelines: [
      "Use books_get with an isbn when you have one - it is the only identifier that means the same book in every catalog.",
      "Without a provider, books_get walks catalogs until one has the book; an ISBN only reaches catalogs that can look one up.",
      "Pass provider 'all' to books_get to compare what each catalog holds: page counts, years and even titles differ between editions.",
      "Every books_get record carries the source URL - cite it rather than presenting merged catalog data as one fact.",
    ],
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
      if (!lib.providerArg(params.provider)) {
        return textResult(lib.formatFallback(await lib.bookWithFallback(query), lib.formatBook));
      }
      const { provider } = lib.selectProvider(params.provider);
      return textResult(lib.formatBook(await lib.requireOperation(provider, "book")(query)));
    },
  });

  pi.registerTool({
    name: "books_search",
    label: "Books Search",
    description: "Find books matching a free-form query",
    promptSnippet: "Use books_search to find the exact title, author and id of a book.",
    promptGuidelines: [
      "Use books_search when the title or author spelling is uncertain; it returns candidates with year, ISBN and provider id.",
      "Feed the id from books_search into books_get or books_text with the same provider for an exact lookup.",
    ],
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
    description: "Read a slice of a public-domain book's text",
    promptSnippet: "Use books_text to read the actual text of a book that is out of copyright.",
    promptGuidelines: [
      "books_text only reaches the public-domain libraries: Project Gutenberg for English and Wolne Lektury for Polish. Books still in copyright are not there and no catalog will serve them.",
      "One books_text call returns a slice, not a book. Read on by passing the nextOffset from the previous result as offset.",
      "Raise the books_text maxBytes only when the task needs a long passage - the text lands in the conversation whole.",
    ],
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
    async execute(_toolCallId, params): Promise<BooksToolResult> {
      const lib = await loadLibrary();
      const query = { title: params.title, author: params.author, id: params.id };
      const options = { offset: params.offset, maxBytes: params.maxBytes };

      if (!lib.providerArg(params.provider)) {
        return textResult(
          lib.formatFallback(await lib.textWithFallback(query, options), lib.formatText),
        );
      }
      const { provider } = lib.selectProvider(params.provider, "text");
      const text = lib.requireOperation(provider, "text");
      return textResult(lib.formatText(await text(query, options)));
    },
  });

  pi.registerTool({
    name: "books_providers",
    label: "Books Providers",
    description: "List registered book providers and what each can serve",
    promptSnippet: "Use books_providers to check which book catalogs are available.",
    promptGuidelines: [
      "Use books_providers to list provider keys and their capabilities: which catalogs search, which resolve an ISBN, which carry full texts and which carry reader ratings.",
    ],
    parameters: Type.Object({}),
    async execute(): Promise<BooksToolResult> {
      const lib = await loadLibrary();
      return textResult(lib.formatProviders(lib.listProviders()));
    },
  });
}
