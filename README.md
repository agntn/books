# @agntn/books

Five book catalogs behind one interface, and the two of them that can hand you the actual book.

A bibliographic record is the same idea everywhere and a different JSON document in every catalog:
Open Library splits a book from its printings, the National Library of Poland ships MARC with its
fields glued together, Lubimyczytać publishes its data as a schema.org node for search engines.
This library reads all five, returns one shape, and tells you which catalog answered.

```bash
npm install @agntn/books
```

## Command line

```console
$ books get 9780441013593
[openlibrary] Dune - Frank Herbert (2005)

Series: Dune (1); Dune Chronicles, Book 1
Publisher: Ace Trade
Pages: 544
ISBN-13: 9780441013593
Rating: 4.3/5 from 443 ratings

Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides...

Source: https://openlibrary.org/books/OL7524304M
```

The positional argument is whatever names the book. Thirteen digits that pass their check digit
are an ISBN; anything else is a title.

```bash
books search "dune herbert" --limit 3      # candidates, with the id for an exact lookup
books search "Lalka Prus" --provider all   # the same query put to every catalog at once
books get "Diuna" --author Herbert -p lubimyczytac
books text "Frankenstein" --author Shelley --bytes 4000
books providers                            # who is registered and what each can serve
```

`books text` reads a slice and tells you where the next one starts, because a novel is several
hundred kilobytes and nobody wants all of it at once:

```console
$ books text "Lalka tom pierwszy" --offset 2000 --bytes 300
[wolnelektury] Lalka, tom pierwszy - Bolesław Prus
Bytes 2000-2300 of 860296

— Już szósta?… Jak ten czas leci!… Wariat! wariat! — mruczał radca Węgrowicz.
...
(continues - read on from 2300)
```

## The catalogs

| Provider       | Search | Record | Text | By ISBN | Ratings | What it is for                                         |
| -------------- | ------ | ------ | ---- | ------- | ------- | ------------------------------------------------------ |
| `openlibrary`  | ✓      | ✓      |      | ✓       | ✓       | The broad default: editions, works, blurbs, scores     |
| `gutendex`     | ✓      | ✓      | ✓    |         |         | Project Gutenberg - English texts, out of copyright    |
| `wolnelektury` | ✓      | ✓      | ✓    |         |         | Polish free-licence library - texts and audiobooks     |
| `bn`           | ✓      | ✓      |      | ✓       |         | Polish national bibliography, read out of its MARC     |
| `lubimyczytac` | ✓      | ✓      |      |         | ✓       | Polish readers: contemporary editions and their scores |

None of them needs an API key. Registration order is the order a lookup walks them: the broad
catalog first, then the two public-domain libraries, then the Polish ones. A Polish edition that
Open Library happens to hold gets answered on the first hop, and one it does not falls through to
a catalogue that does.

Two of the columns are there to stop a request that would answer wrongly rather than not at all.
An ISBN lookup only visits catalogs that index ISBNs - Lubimyczytać's search box, handed a number,
returns unrelated books with perfect confidence. And only the two public-domain libraries have
texts, because they are the only two entitled to give them away.

## Library

```ts
import { bookWithFallback, create, searchAll, textWithFallback } from "@agntn/books";

// Walk the catalogs until one has it; `skipped` says who was passed over and why.
const { provider, result, skipped } = await bookWithFallback({ isbn: "9788375780635" });

// Or address one catalog directly.
const matches = await create("lubimyczytac").search("Sapkowski", { limit: 5 });

// Compare what every catalog holds for the same query - editions disagree about everything.
const comparison = await searchAll("Lalka Prus", { limit: 2 });

// Read a book that is out of copyright, one slice at a time.
let offset = 0;
for (let page = 0; page < 3; page++) {
  const { result: slice } = await textWithFallback({ title: "Frankenstein" }, { offset });
  process.stdout.write(slice.text);
  if (slice.nextOffset === undefined) break;
  offset = slice.nextOffset;
}
```

Anything that goes wrong arrives as a `BooksError`: `NotFoundError` when a catalog does not have
the book, `ParseError` when a scraped page changed its layout, `InvalidInputError` when an ISBN
fails its check digit before any request goes out. ISBN handling is exported too - `toIsbn13`,
`isIsbn`, `assertIsbn` - because normalizing an identifier is half the work of asking about it.

## For agents

**MCP** - four read-only tools (`books_search`, `books_get`, `books_text`, `books_providers`):

```bash
claude mcp add books --scope user -- node ~/Projekty/agntn/books/dist/cli.mjs mcp
```

**Vercel AI SDK** - `import { bookTool, searchTool, textTool, providersTool } from "@agntn/books/ai"`.

**Pi and OMP** - the package ships an extension for each; `pi install <path>` and
`omp install <path>` register the same four tools.

## Worth knowing

- **Texts are only ever public-domain ones.** A book still in copyright has a record here and no
  text, and no argument to `books text` will change that. The Gutenberg licence header stays
  inside the text where the licence requires it.
- **Two providers read HTML.** Lubimyczytać and the Wolne Lektury search page have no API for
  what this library needs. A redesign surfaces as `ParseError` naming the page - and their terms
  of service govern automated access, which is the operator's decision to make, not this
  library's to assume.
- **The National Library indexes fields, not free text.** A search is tried as a title and then
  as an author; a phrase mixing both finds nothing, the way it would in the catalogue itself.
- **Gutendex has bad days.** It answers in half a second, or with a 503, or not at all - all
  three were seen within minutes during the API audit. A backend that returns 5xx is passed over
  and reported in `skipped`; one that hangs stops the walk rather than spending everyone's
  timeout.
- **Catalogs disagree.** Different editions, different page counts, sometimes different titles
  for the same book. `--provider all` shows the disagreement instead of hiding it, and every
  record carries the source URL it came from.

## Development

```bash
pnpm install
pnpm test        # vitest, every backend stubbed
pnpm typecheck   # tsc, then build, then the extensions
pnpm build       # obuild - one bundle, four entries sharing the provider registry
```

MIT © [oritwoen](https://github.com/oritwoen)
