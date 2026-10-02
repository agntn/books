import { vi } from "vite-plus/test";

/** One stubbed response: a JSON body, an HTML page, or raw bytes. */
export interface StubRoute {
  readonly body: unknown;
  readonly status?: number;
  readonly html?: boolean;
  /** Raw bytes, for the range requests the full-text providers make */
  readonly bytes?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
}

/* Stub global fetch with a per-URL body map; unmatched URLs answer 404. */
export function stubRoutes(routes: Readonly<Record<string, StubRoute>>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    if (!match) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [, route] = match;
    if (route.bytes) {
      return rangeResponse(route.bytes, new Headers(init?.headers).get("range"), route.headers);
    }
    return new Response(route.html ? String(route.body) : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: {
        "Content-Type": route.html ? "text/html; charset=utf-8" : "application/json",
        ...route.headers,
      },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/* Serve a byte range the way a static file server does, honouring the `Range` header. */
function rangeResponse(
  bytes: Uint8Array,
  range: string | null,
  headers?: Readonly<Record<string, string>>,
): Response {
  const match = range?.match(/bytes=(\d+)-(\d+)/);
  if (!match) {
    return new Response(bytes as BodyInit, { status: 200, headers });
  }
  const from = Number(match[1]);
  const to = Math.min(Number(match[2]), bytes.byteLength - 1);
  return new Response(bytes.subarray(from, to + 1) as BodyInit, {
    status: 206,
    headers: {
      "Content-Range": `bytes ${from}-${to}/${bytes.byteLength}`,
      ...headers,
    },
  });
}

/* Stub global fetch with one JSON body; returns the mock for call inspection. */
export function stubJSON(body: unknown, status = 200) {
  return stubRoutes({ "": { body, status } });
}

/* Stub global fetch with one HTML body; returns the mock for call inspection. */
export function stubHTML(body: string, status = 200) {
  return stubRoutes({ "": { body, status, html: true } });
}

/* URL of one stubbed fetch call, whichever form the client passed it in. */
export function calledUrl(call: readonly unknown[] | undefined): string {
  const input = call?.[0];
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : String(input);
}

/* Look up a registered extension tool, failing loudly when registration missed it. */
export function requireTool<T>(tools: ReadonlyMap<string, T>, name: string): T {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

/**
 * A placeholder book text with Polish characters, so range arithmetic is exercised against
 * multi-byte sequences rather than ASCII that happens to line up.
 */
export const FAKE_TEXT =
  "Rozdział pierwszy.\nŁódź płynęła z prądem, a źdźbło trawy uparcie trwało przy brzegu.\nKoniec.";

/** The same text as UTF-8 bytes, which is what a text file actually is. */
export const FAKE_TEXT_BYTES = new TextEncoder().encode(FAKE_TEXT);

/** Open Library edition record, as `/isbn/{isbn}.json` returns it, trimmed to the read fields. */
export const OPENLIBRARY_EDITION = {
  key: "/books/OL7524304M",
  title: "Placeholder Novel",
  publishers: ["Placeholder Press"],
  publish_date: "August 2, 2005",
  number_of_pages: 544,
  isbn_10: ["0441013597"],
  isbn_13: ["9780441013593"],
  languages: [{ key: "/languages/eng" }],
  covers: [14565843],
  series: ["Placeholder Series (1)"],
  works: [{ key: "/works/OL893414W" }],
  authors: [{ key: "/authors/OL79034A" }],
};

/** Open Library work record, which is where blurbs and subjects live. */
export const OPENLIBRARY_WORK = {
  key: "/works/OL893414W",
  title: "Placeholder Novel",
  subjects: ["Science fiction", "Placeholder"],
  description: { value: "A placeholder blurb for a placeholder novel." },
};

/** Gutendex catalog record, trimmed to the fields this library reads. */
export const GUTENDEX_BOOK = {
  id: 84,
  title: "Placeholder Gothic Novel",
  authors: [{ name: "Placeholder, Mary", birth_year: 1797, death_year: 1851 }],
  translators: [],
  summaries: ["A placeholder summary."],
  subjects: ["Gothic fiction"],
  bookshelves: ["Category: Novels"],
  languages: ["en"],
  copyright: false,
  media_type: "Text",
  formats: {
    "text/html": "https://www.gutenberg.org/ebooks/84.html.images",
    "text/plain; charset=utf-8": "https://www.gutenberg.org/ebooks/84.txt.utf-8",
    "image/jpeg": "https://www.gutenberg.org/cache/epub/84/pg84.cover.medium.jpg",
  },
  download_count: 58_824,
};

/** Wolne Lektury book record, as `/api/books/{slug}/` returns it. */
export const WOLNELEKTURY_BOOK = {
  title: "Placeholder Powieść",
  url: "https://wolnelektury.pl/katalog/lektura/placeholder/",
  language: "pol",
  authors: [{ name: "Placeholder Prus", slug: "placeholder-prus" }],
  translators: [],
  epochs: [{ name: "Pozytywizm" }],
  genres: [{ name: "Powieść" }],
  kinds: [{ name: "Epika" }],
  cover: "https://wolnelektury.pl/media/book/cover/placeholder.jpg",
  txt: "https://wolnelektury.pl/media/book/txt/placeholder.txt",
  epub: "https://wolnelektury.pl/media/book/epub/placeholder.epub",
  pdf: "https://wolnelektury.pl/media/book/pdf/placeholder.pdf",
  html: "",
  isbn_epub: "ISBN 978-83-288-3733-1",
  children: [],
  parent: null,
};
