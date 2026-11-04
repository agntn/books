# Contributing

## Setup

The README has the commands. Run `pnpm install` at the root. That's the whole install.

`pnpm lint`, `pnpm fmt` and `pnpm typecheck` run `pnpm build` first. The Pi and OMP extensions import types from `dist/tools.d.mts`. Without that file, type-aware lint rules read them as `error` types.

`test/unit/cli.test.ts` runs the built bin and skips itself when `dist/` is missing. That means a fresh checkout stays green on `pnpm test` without running those checks. Build first to run them. CI builds before it tests.

Run `books mcp` from a checkout and it serves `src/mcp.ts`. Restart the server after a change. Only an edit to `src/cli.ts` itself needs `pnpm build`. Set `BOOKS_DIST=1` to pin the server to the bundle. A provider preloaded into the bin by a host using `node --import` appears only under `BOOKS_DIST=1`. The source server fills its own registry.

## Texts and scans

Only public-domain texts belong here. That's a decision, not a gap to fill. `text()` reaches Project Gutenberg and Wolne Lektury because nothing else here has the right to give a book away. Keep Gutenberg's licence header inside the text.

`followText()` reads lending-only Internet Archive scans on purpose. #26 asked for it and #29 decided it. It serves the search passages that `searchText()` returns, up to `MAX_FOLLOW_STEPS` per call. That's quoting around a phrase, not serving the book. Open Library's `text` capability stays false.

Lubimyczytać and the Wolne Lektury search page are read as HTML. Their terms of service restrict automated access. Whether to use them is the operator's decision, documented in the README. This library doesn't claim a right to access them.

## A new provider

Verify the API live before writing a provider. Map every field from a real response, never from documentation alone.

Why isn't Google Books here? Keyless clients get HTTP 429 with `quota_limit_value: 0`, which is a polite way to say never. ISBNdb returns 401 and needs a paid plan. Hardcover returns 400 without a bearer token. Get a key, verify the response shapes, then add the provider.

Requests carry the identifying `agntn-books/<version> (+url)` User-Agent. All five backends accept it, including both HTML sites. Don't imitate a browser.

Capabilities say what a provider can answer correctly, not just what it can answer. Keep `isbn` false where the backend can't resolve the number. Give Lubimyczytać's search an ISBN and it returns unrelated books with perfect confidence.

The import order in `src/providers/index.ts` is the order a fallback lookup walks. A record key from a response goes through `recordPath()` before it lands in the next request path.

## Tests

Tests never hit live sites. Every provider test stubs `fetch`. `test/setup.ts` fails a test that reaches past its stub, except for a loopback server the test started itself.

Fixtures are invented. Don't commit real book text. `test/helpers.ts` serves byte ranges like a static file server, so the range arithmetic runs for real.

## Pi and OMP

The Pi peer range is `>=0.84.2 <2`. Before it moves to the next major, install the packed tarball next to that Pi and call the tools in a real `pi -p` session. Pi 1.x got exactly that check before the range opened.

## Releasing

Every push to `main` refreshes a draft release PR from [uppt](https://github.com/danielroe/uppt). The version comes from conventional commits. Check it, then merge the PR. That tags `vX.Y.Z`. On the tag, `release.yml` tests, packs and publishes to npm through the trusted publisher.

## Pull requests

Keep pull request and issue descriptions short and freeform. Say why the change is needed or what went wrong.
