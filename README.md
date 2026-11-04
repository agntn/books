# @agntn/books

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/books)](https://npmx.dev/package/@agntn/books)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/books)](https://npmx.dev/package/@agntn/books)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/books)](https://npmx.dev/package/@agntn/books)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/books)

📚 Five catalogs, two sources of public domain texts. You ask for a book, you get its record, its text, or a passage from a scan.

## Why?

Open Library splits works from editions. Poland's National Library glues fields together in MARC. Lubimyczytać hands search engines a schema.org node. Give all three to an agent, and it has three formats to untangle. This library reads five catalogs and returns one shape with the source.

## ✨ Features

- 📇 **Five catalogs.** You get records and ratings without an API key.
- 🔎 **ISBN or title.** Ten or thirteen digits with a valid check digit get an ISBN lookup.
- 🇵🇱 **Three Polish catalogs.** You can search Wolne Lektury, BN, and Lubimyczytać.
- 🔀 **Fallback.** You get the first catalog that has it, and `skipped` tells you who was passed over.
- 🪞 **Compare answers.** Use `-p all` to see where the catalogs disagree.
- 📖 **Public domain texts.** You can read slices from Gutendex and Wolne Lektury.
- 🗣️ **Search inside scans.** Find a phrase in Internet Archive books through Open Library.
- 🧵 **Follow a passage.** Read on through a scan, forward or backward.
- 🤖 **Agent tools.** Give the same operations to Pi, OMP, MCP, or the AI SDK.

## 📦 Install

```bash
pnpm add @agntn/books
```

Node.js 26 or newer.

## 🚀 First call

```bash
npx @agntn/books get 9788375780635
```

```text
[openlibrary] Wiedzmin Ostatnie zyczenie - Andrzej Sapkowski (2014)

Publisher: SuperNOWA
Published: Apr 17, 2014
Pages: 332
ISBN-13: 9788375780635
ISBN-10: 8375780634
Id: OL32217717M
Cover: https://covers.openlibrary.org/b/id/10862107-L.jpg

Source: https://openlibrary.org/books/OL32217717M
Catalog data from Open Library (openlibrary.org)
```

No key, no config. Open Library found the edition and dropped the Polish letters. Lubimyczytać spells the title "Ostatnie życzenie". After `pnpm add`, the bare command is `pnpm exec books`, or install once with `pnpm add -g @agntn/books`.

### Commands

| Command                   | What it does                                                   |
| ------------------------- | -------------------------------------------------------------- |
| `search <query...>`       | Candidates, with the ID for an exact lookup                    |
| `get <isbn or title>`     | One book's record                                              |
| `text <title>`            | A slice of a public domain text                                |
| `search-text <phrase...>` | A phrase inside scanned books                                  |
| `follow-text <phrase...>` | Reads on through one scan from that phrase. Requires `--book`. |
| `providers`               | Who is registered and what each can serve                      |
| `mcp`                     | MCP server over stdio                                          |

```bash
books search Lalka Prus -p all -n 2
```

```text
[openlibrary] 2 matches for "Lalka Prus":
Lalka - Bolesław Prus  (1890, rus, ISBN 9780701161408, 4/5 from 3 ratings, id=OL2852373W, https://openlibrary.org/works/OL2852373W)
Lalka - Bolesław Prus  (1968, pol, id=OL38726454W, https://openlibrary.org/works/OL38726454W)

[gutendex] No matches for "Lalka Prus"

[wolnelektury] No matches for "Lalka Prus"

[bn] 2 matches for "Lalka Prus":
Bolesław Prus "Lalka" - Klukowski, Bogdan  (1992, polski, id=1040292, https://data.bn.org.pl/api/institutions/bibs.json?id=1040292)
Bolesław Prus: Lalka - Mikułowski, Jan  (1914, polski, id=1410745, https://data.bn.org.pl/api/institutions/bibs.json?id=1410745)

[lubimyczytac] 2 matches for "Lalka Prus":
Lalka - Bolesław Prus  (polski, 8.1/10 from 143 ratings, id=5231446/lalka, https://lubimyczytac.pl/ksiazka/5231446/lalka)
Lalka - audio opracowanie - Bolesław Prus  (polski, id=4838618/lalka-audio-opracowanie, https://lubimyczytac.pl/ksiazka/4838618/lalka-audio-opracowanie)
```

Five catalogs, five ideas of what you meant. Open Library starts with an 1890 work tagged `rus`, while two catalogs find nothing. Lubimyczytać adds an audio study guide. BN reads the query as a title, then as an author. "Lalka Prus" is neither, so you get titles with both words in them: books about _Lalka_.

```bash
books text "Lalka tom pierwszy" -p wolnelektury -o 2000 -b 300
```

```text
[wolnelektury] Lalka, tom pierwszy - Bolesław Prus
Bytes 2000-2300 of 860296

Józio.

— Już szósta?… Jak ten czas leci!… Wariat! wariat! — mruczał radca Węgrowicz.

Dla osób posilających się w tej co radca jadłodajni, dla jej właściciela, subiektów i chłopców przyczyny klęsk mających paść na S. Wokulskiego i jego sklep galanteryjny były tak jasn

(continues - read on from 2300)
Source: https://wolnelektury.pl/media/book/txt/lalka-tom-pierwszy.txt
Free-licence text from Wolne Lektury (wolnelektury.pl)
```

That's 860296 bytes of novel. Nobody wants all of it at once. The continuation line tells you where to read on. A slice defaults to 32768 bytes and tops out at 262144.

```bash
books search-text the spice must flow --book dunehousecorrino0000herb
```

```text
[openlibrary] "the spice must flow" in dunehousecorrino0000herb (page 1):
Dune : House Corrino - Herbert, Brian  (2001, page 694, id=dunehousecorrino0000herb)
  > piles.” “We have a mystery here.” “{{{The spice must flow}}}.” “All melange harvesting and processing
  > production to salve your petty pride. {{{The spice must flow}}}.” Shaddam sniffed. “Then perhaps you
  https://archive.org/details/dunehousecorrino0000herb?q=%22the+spice+must+flow%22
Passages from Internet Archive scans, found through Open Library
```

The spice must flow, but a dozen words isn't much of a read. Use `follow-text` to search again from the last words and stitch passages together. It runs three searches by default, and each can take half a minute. Set `--steps` or use `--backward` to read the other way.

Phrase search also finds books still in copyright. Every word has to sit next to the others. A common phrase can bury your book beyond the pages read. If `--book` comes back empty, try a rarer phrase from that book.

Search and phrase queries need no quotes. For `get` and `text`, quote a title with multiple words. Use `-p` for provider, `-n` for limit, `-a` for author, `-o` for offset, `-b` for maximum bytes, and `--json` for details. See `books <command> --help`.

## 🧠 Library

```ts
import { bookWithFallback, create, searchAll } from "@agntn/books";

// Walk the catalogs until one has it. `skipped` says who was passed over and why.
const { provider, result, skipped } = await bookWithFallback({ isbn: "9788375780635" });

// Or ask one catalog directly.
const matches = await create("lubimyczytac").search("Sapkowski", { limit: 5 });

// Same query, every catalog, each answer kept apart.
const comparison = await searchAll("Lalka Prus", { limit: 2 });
```

Text comes the same way. `textWithFallback({ title: "Frankenstein" }, { offset })` puts the slice in `result`, so read `result.text` and `result.nextOffset`. The offset is `undefined` at the end. Errors arrive as `BooksError` subclasses, including `NotFoundError`, `ParseError`, and `InvalidInputError`. You can probably guess which is which.

See the [exports](./src/index.ts), [result types](./src/core/types.ts), and [errors](./src/core/errors.ts).

## 🗺️ Providers

| Provider       | Search | Record | Text | Inside | By ISBN | Ratings | What it is for                                    |
| -------------- | ------ | ------ | ---- | ------ | ------- | ------- | ------------------------------------------------- |
| `openlibrary`  | ✓      | ✓      |      | ✓      | ✓       | ✓       | Broad default: editions, works, blurbs, scores    |
| `gutendex`     | ✓      | ✓      | ✓    |        |         |         | Project Gutenberg, English texts out of copyright |
| `wolnelektury` | ✓      | ✓      | ✓    |        |         |         | Polish free licence library, texts and audiobooks |
| `bn`           | ✓      | ✓      |      |        | ✓       |         | Polish national bibliography from MARC            |
| `lubimyczytac` | ✓      | ✓      |      |        |         | ✓       | Polish editions and reader scores                 |

Fallback walks this order. ISBN lookups visit only Open Library and BN. Give Lubimyczytać's search box an ISBN and it returns unrelated books with perfect confidence. So ISBN lookups skip it.

Gutendex has bad days: in one session, one query came back at once and another took 42 seconds. A 5xx gets passed over and lands in `skipped`. A hang past the 15 second timeout stops the walk. Know who has your book? Pass `-p`.

See the [provider implementations](./src/providers).

## 🤖 Agents

```bash
pi install npm:@agntn/books
omp install @agntn/books
books mcp
```

```json
{
  "mcpServers": {
    "books": {
      "command": "npx",
      "args": ["-y", "@agntn/books", "mcp"]
    }
  }
}
```

Pi and OMP register the same read-only tools, and `books mcp` serves them over stdio. They are `books_providers`, `books_search`, `books_get`, `books_text`, `books_text_search`, and `books_text_follow`. See the [tools](./src/tools.ts) and [AI SDK tools](./src/ai.ts).

For the AI SDK, install the `ai` peer dependency:

```ts
import {
  bookTool,
  searchTool,
  textTool,
  textSearchTool,
  textFollowTool,
  providersTool,
} from "@agntn/books/ai";
```

## 📜 Copyright still applies

`books text` only returns public domain texts. No argument changes that. Gutenberg's licence header stays inside the text, as the licence requires.

Lubimyczytać and the Wolne Lektury search page are read as HTML. A redesign can produce a `ParseError` naming the page. Check their terms of service before automated access. That's your decision as the operator, not the library's to assume.

## 🧩 Adding a provider

Got a sixth catalog? Subclass `Provider`, say what it can answer, then `register()` it. Start with [Gutendex](./src/providers/gutendex.ts), then read [A new provider](./CONTRIBUTING.md#a-new-provider).

## 🛠️ Development

```bash
pnpm install
pnpm test        # vp test, every backend stubbed
pnpm typecheck   # tsc, then build, then the extensions
pnpm lint        # build, then vp lint and vp fmt --check
pnpm fmt         # build, then lint fixes and formatting
pnpm build       # obuild
```

[CONTRIBUTING.md](./CONTRIBUTING.md) covers texts, MCP from a checkout, tests, and releases.

## 💛 Thanks

Anthropic and OpenAI chip in through [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss). Thanks for helping keep this work going.

## 📄 License

[MIT](./LICENSE) © [oritwoen](https://github.com/oritwoen)
