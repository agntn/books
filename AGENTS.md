# books - AGENTS.md

## Scope

Unified book provider library. Normalizes catalog search, bibliographic records and public-domain
full text across five backends, with ISBN validation and UTF-8-safe range reading in core.
Exports a CLI (`books` binary), a programmatic API, an MCP server (`@agntn/books/mcp`), Vercel AI
SDK tools (`@agntn/books/ai`), and Pi/OMP extensions.

## Providers

| Provider     | Auth | Capabilities                | Notes                                                    |
| ------------ | ---- | --------------------------- | -------------------------------------------------------- |
| openlibrary  | none | search, book, isbn, ratings | Work/edition split; a record is stitched from both       |
| gutendex     | none | search, book, text          | Project Gutenberg; no dates, no ISBNs; flaky under load  |
| wolnelektury | none | search, book, text          | JSON API without search; the result page is read as HTML |
| bn           | none | search, book, isbn          | Flat fields are mangled MARC; the MARC itself is read    |
| lubimyczytac | none | search, book, ratings       | HTML only; the schema.org node is the durable surface    |

No built-in provider needs a credential. The `envKey` machinery on `ProviderConstructor` exists
for providers a host registers, and `listProviders()` reports it.

## API audit (2026-08-24)

Live verification performed before scaffolding, per the agntn scaffold procedure. Five backends
answered; three candidates were dropped.

- **Open Library** (`openlibrary.org`): `/search.json` verified with `fields=` (without it every
  match carries its whole search index - one doc listed several hundred ISBNs). `/isbn/{isbn}.json`
  answers 302 to `/books/{OL…M}.json`; ofetch follows it. `/works/{id}/ratings.json` returns
  `{ summary: { average, count } }`, and a work nobody rated answers with nulls. Authors arrive as
  keys, one request each. **A record exists under ISBN `9999999999999`** - catalogs store what
  cataloguers typed, and that number fails its check digit, so `assertIsbn` refuses it before the
  request. `/isbn/0000000000000.json` is a real 404.
- **Gutendex** (`gutendex.com`): `/books?search=` and `/books/{id}` verified. `/books?search=` 301s
  to `/books/?search=`. `formats` is a media-type map; the plain text is `text/plain; charset=utf-8`
  and `gutenberg.org` honours `Range` (206 with `Content-Range`). **Availability is uneven**: the
  same query returned 200 in 0.4 s, 503 after 15 s, and timed out at 20 s, all within minutes.
- **Wolne Lektury** (`wolnelektury.pl`): `/api/books/{slug}/` verified. There is **no search
  endpoint** - `/api/search/?q=` is a 404 page and `?search=` on `/api/books/` is ignored, returning
  the head of the catalog. `/szukaj/?q=` is HTML: `article.l-books__item` with `h2 a` (title, slug)
  and `h3 a` (author). A multi-volume work has empty `txt`/`html` and its volumes in `children`.
  ISBNs are per file format and printed as `ISBN 978-83-288-3733-1`.
- **National Library of Poland** (`data.bn.org.pl`): `/api/institutions/bibs.json` verified with
  `title`, `author`, `isbnIssn`, `id`, `limit`. **An unrecognized parameter is silently ignored**
  and the API answers with the head of the catalog - `?search=` and `?q=` both returned records
  that look real for a query nobody made. Each record carries ~3.4 kB of MARC, which is where the clean
  data is; the flat fields concatenate subfields (`author` repeats the name with the publisher
  glued in between). **`isbnIssn` matches the string the cataloguer typed**, not the number:
  `9788370540791` finds nothing while `8370540791` finds three records, and `0575083182` finds
  nothing while `9780575083189` finds two (2026-09-19). `boolean=true` turns on the documented
  `|` between alternatives inside one field, and `9788370540791 | 8370540791` finds the three.
- **Lubimyczytać** (`lubimyczytac.pl`): `/szukaj/ksiazki?phrase=` and `/ksiazka/{id}/{slug}`
  verified. `/ksiazka/{id}` without the slug is a 404, so an id here is the path pair. **Its search
  cannot resolve an ISBN** - `phrase=9788381884105` answered with unrelated books, hence
  `isbn: false`. The page carries a schema.org `Book` node, and **that node is invalid JSON**
  whenever a reader review contains a quotation mark (the live Dune page opens a review with
  `"Diuna" jest…`); `review` is the last property, so the node is salvaged by cutting in front of
  it. The blurb is not in the node - it is `#book-description`.
- **Dropped**: Google Books (`books.googleapis.com` answers HTTP 429 with
  `quota_limit_value: 0` for keyless clients, so no field could be verified against a live
  response), ISBNdb (401 - a paid plan), Hardcover (400 without a bearer token). Do not scaffold
  any of them from documentation alone; get a key, verify the shapes, then add the provider.
- **User-Agent**: the identifying `agntn-books/<version> (+url)` string is accepted by all five
  backends, the two HTML sites included. Do not imitate a browser.

## Conventions

- Three operations: `search(query, options)`, `book(query)` and `text(query, options)`. `book` is
  abstract on `Provider`; `search` and `text` are optional methods, and `requireOperation()` checks
  the capability flag _and_ the method before returning it bound
- `ProviderCapabilities` carries the three operations plus `isbn` and `ratings`, which describe
  what a provider can resolve and what its records hold. `usableProviders()` answers for all five,
  which is what keeps an ISBN lookup out of the catalogs that would answer it wrongly
- `BookQuery` fields are alternatives, not a conjunction: `isbn`, `id`, or `title` (sharpened by
  `author`). An author alone is rejected - "a book by Herbert" names a shelf, not a book
- `assertBookQuery()` normalizes and validates the ISBN once, at the boundary. A mistyped ISBN is
  a different book, not a missing one, so it fails before a request rather than returning a
  plausible record for the wrong title
- `bookWithFallback()` and `textWithFallback()` are `async` so a rejected query comes back as a
  rejected promise; a function that sometimes throws synchronously slips past a caller's `.catch`
- The fallback walk skips "this one does not have it" failures - `NotFoundError`, `AuthError`,
  `PaymentError`, `UnsupportedOperationError`, `ParseError`, `InvalidInputError` - **and 5xx**,
  because a backend that is down costs nothing to pass over and is reported in `skipped`. A
  timeout (`HTTPError` with status 0) and a rate limit stop the walk: five providers at fifteen
  seconds each is over a minute of waiting, and a rate limit retried elsewhere hides a real problem
- `InvalidInputError` is skippable inside the walk because provider ids have provider-specific
  shapes (`84` is a Gutenberg book and gibberish to Open Library). The walk validates the query
  itself first, so an input error from inside a provider is about that provider's id format
- Text is read in byte ranges: `readTextSlice()` sends `Range`, falls back to slicing locally when
  a server answers 200, and `trimPartialUtf8()` cuts the result back to whole characters. A byte
  range lands mid-character in any Polish text, and half of `ł` is a replacement character in two
  adjacent slices. `offset + bytes` is the next offset, which is what `nextOffset` carries
- `clampTextBytes()` bounds one slice at `MAX_TEXT_BYTES`; the ceiling protects the caller's
  context window and has nothing to do with which library serves the file
- The HTTP client retries **once**, and only because every request here is a GET. Gutendex made
  the case for it during the audit. Each attempt gets its own `AbortSignal.timeout` from an
  `onRequest` hook: ofetch 1.5.1 arms its timer once and hands the retry the first attempt's
  signal, so without the hook a retry after a timeout never leaves the process
- `jsonLd()` parses a block, and when that fails, retries with everything from `"review"` onwards
  cut off. It is not defensive coding - it is the only way the Lubimyczytać node parses at all
- Provider construction never checks credentials, which keeps `create()` total so `listProviders()`
  and `supportsOperation()` can answer for any provider
- `selectProvider()` in `core/resolve.ts` is the single selection path for the CLI, MCP, AI tools
  and both extensions; empty or whitespace-only arguments count as absent. `all` is reserved and
  tested with `isAllProviders()` before selection
- Internal imports use explicit `.ts` extensions (nodenext + `allowImportingTsExtensions`);
  `erasableSyntaxOnly` forbids parameter properties
- Provider registration is a class side effect: importing `src/providers/index.ts` triggers all
  `register()` calls - because of that, `package.json` must NOT declare `sideEffects: false`
- One obuild bundle with five inputs (`index`, `cli`, `mcp`, `ai`, `tools`) so every entry shares
  the chunk holding the registry

## Key files

- `src/core/types.ts` - `Book`, `BookMatch`, `BookText`, `BookQuery`, `Rating`, capabilities,
  `clampMaxResults`, `clampTextBytes`
- `src/core/isbn.ts` - normalization, both check digits, 10↔13 conversion, `assertIsbn`
- `src/core/text.ts` - `normalizeText`, `parseYear`, `uniqueStrings`, `trimPartialUtf8`
- `src/core/client.ts` - ofetch wrapper: `getJSON`, `getText`, `readTextSlice` (ranges), 15 s
  timeout, one retry, identifying User-Agent
- `src/core/html.ts` - `parseHtml`, JSON-LD reading with the review salvage, OpenGraph helpers
- `src/core/provider.ts` - abstract `Provider`, `assertBookQuery`, `requireOperation` gate
- `src/core/errors.ts` - error hierarchy + `normalizeError` + URL sanitization
- `src/core/registry.ts` - self-registering registry
- `src/core/resolve.ts` - capability-aware selection
- `src/core/all.ts` - `searchAll`, `bookAll`, `bookWithFallback`, `textWithFallback`
- `src/core/format.ts` - plain-text formatters shared by every output surface
- `src/providers/*.ts` - one file per provider; order in `index.ts` is the fallback order
- `src/tools.ts` - the four tool definitions every agent surface serves through `@agntn/tools`:
  one TypeBox schema each, built with `Type` from `@agntn/tools` (OMP rewrites a bare `typebox`
  import). Optional text arguments take `""` as absent; the executors trim and drop blanks
- `src/tool-operations.ts` - executors behind them: the `core/format.ts` text for the model on
  every surface, the same facts as `details` (AI SDK output `{ ...details, text }`, so the text
  slice sits in `slice`). Loaded on the first call, so registering the tools loads no provider
- `src/mcp.ts` - `createMcpServer()` on MCP SDK v2 through `@agntn/tools/mcp`
- `src/commands/mcp.ts` - imports the SDK inside `run()`: citty resolves every lazy subcommand to
  read its `meta`, so a top-level import would put the SDK in the startup path of `books --help`
- `src/commands/args.ts` - `parseNumericArg`, and `toBookQuery` which reads the positional as an
  ISBN when it parses as one
- `packages/pi/extensions/books.ts`, `packages/omp/extensions/books.ts` - agent extensions over
  `registerPiTools` / `registerOmpTools`; type-import from `dist/tools.d.mts`. The OMP loader keeps
  both dynamic imports literal and takes `Text` from `pi.pi`: an import from
  `@oh-my-pi/pi-coding-agent/tui` stopped the extension loading in compiled OMP, and the test
  mock of that module throws. The status line cuts an argument to 100 characters before
  `sanitizeLine`, which is quadratic on an unclosed `ESC]`
- `packages/shared/tui.ts` - collapsed result previews for both extensions: ten lines cut to a
  200-character width, the complete text once the row is expanded

## Constraints

- **Only public-domain texts.** `text()` reaches Gutenberg and Wolne Lektury; nothing else here
  has the right to serve a book. The Gutenberg licence header stays inside the text
- The two HTML providers depend on site layout, and their terms of service restrict automated
  access - an operator decision documented in the README, not a right this library asserts
- Test fixtures are invented. No real book text is committed to this repository
- Tests never hit the live sites: every provider test stubs `fetch`, and `test/helpers.ts` serves
  byte ranges the way a static file server does, so the range arithmetic is exercised for real
- Open Library's `search.json` reports the language of some edition in its index, not the language
  of the book: a search for Dune can come back `gre`
- `openlibrary.book()` resolves at most `MAX_AUTHOR_LOOKUPS` (5) author names; an anthology's
  remaining contributors are dropped rather than fanned out into dozens of requests
- Record keys arriving in a provider's response go through `recordPath()` before they are
  interpolated into the next request path. WHATWG resolves `..` inside a path, so an unchecked
  `works[0].key` would send the request to a different resource on the same host
- `sanitizeUrl` redacts credentials in query parameters _and_ in a path segment (the Alchemy and
  Infura shape). The path rule is deliberately narrow - 24+ characters, letters and digits, no
  dot - so `OL7524304M`, an ISBN and `lalka-tom-pierwszy.txt` survive: a 404 naming the resource
  is diagnosable, `/REDACTED` is not
- `bn.query()` asks for `limit + DELETED_MARGIN` because the catalog applies `limit` before
  withdrawn records are filtered out here. Without the margin a single-record lookup that lands
  on a withdrawn entry reports "not found" for a book the catalog holds
- `bn.locate()` sends an ISBN in both lengths (`isbnForms()`), joined with `|` under
  `boolean=true`: every edition before 2007 was catalogued with ten digits, and `isbnIssn` does
  not convert. A `979` number has no ten-digit form and goes alone
- `readSlice()` checks that a file URL is http(s) but does **not** pin the host: Gutenberg serves
  its texts from a different host than the API that names them, so a provider handing out a URL
  is trusted about where the file lives
- Writing extension files: **the editor tooling has twice injected raw control bytes** where
  Unicode escape sequences were intended, leaving a file that greps as binary. Check with
  `cat -A` and repair with a script that builds the escapes programmatically

## Testing

`pnpm test` (vitest, 19 files / 181 tests, every backend stubbed via `vi.stubGlobal("fetch", ...)`).

Verified beyond the suite:

- MCP over stdio on the built `dist` with `DEBUG=1`, confirming stdout carries only JSON-RPC
  frames, then calling `books_get` and `books_text` against the live backends
- Packed-layout gate: `pnpm pack`, `npm install --legacy-peer-deps` in an empty directory, a
  provider registered through the package entry and then listed by `books_providers` from
  `@agntn/books/mcp` - which is what proves both bundles share one registry chunk

## Build & scripts

```bash
pnpm build       # obuild → dist/ (one bundle: index, cli, mcp, ai)
pnpm typecheck   # tsc → build → tsc -p tsconfig.extensions.json
pnpm test        # vitest --run
pnpm fmt         # oxlint --fix + oxfmt
pnpm lint        # oxlint + oxfmt --check
```

`pnpm install --ignore-scripts` breaks the build: `rolldown-plugin-dts` fails with
`Unexpected end of JSON input` because the TypeScript 7 native binary never gets installed.
