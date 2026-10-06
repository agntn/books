import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getCommand, textCommand } from "../../src/cli-commands.ts";
import { InvalidInputError, NotFoundError } from "../../src/core/errors.ts";
import { OPENLIBRARY_EDITION, OPENLIBRARY_WORK, calledUrl, stubRoutes } from "../helpers.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("books get", () => {
  it("looks a word that checks out as an ISBN up as one", async () => {
    const fetch = stubRoutes({
      "/isbn/": { body: OPENLIBRARY_EDITION },
      "/works/OL893414W.json": { body: OPENLIBRARY_WORK },
      "/authors/OL79034A.json": { body: { name: "Placeholder Herbert" } },
    });

    const result = await getCommand.execute({ book: "0-441-01359-7", provider: "openlibrary" }, {});

    expect(calledUrl(fetch.mock.calls[0])).toContain("/isbn/0441013597");
    expect(result.details).toMatchObject({ book: { title: "Placeholder Novel" } });
  });

  it("takes a word whose check digit fails as a title", async () => {
    const fetch = stubRoutes({ "/search.json": { body: { numFound: 0, docs: [] } } });

    await expect(
      Promise.resolve(getCommand.execute({ book: "0441013598", provider: "openlibrary" }, {})),
    ).rejects.toThrow(NotFoundError);
    expect(calledUrl(fetch.mock.calls[0])).toContain("title=0441013598");
  });
});

describe("books text", () => {
  it("stops a word that checks out as an ISBN before any request", async () => {
    const fetch = stubRoutes({});

    await expect(
      Promise.resolve(textCommand.execute({ book: "978-0-441-01359-3" }, {})),
    ).rejects.toThrow(
      new InvalidInputError("9780441013593 is an ISBN, and no library with texts takes one"),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads any other word as a title", async () => {
    const fetch = stubRoutes({ "/books": { body: { count: 0, results: [] } } });

    await expect(
      Promise.resolve(textCommand.execute({ book: "Placeholder Novel", provider: "gutendex" }, {})),
    ).rejects.toThrow(NotFoundError);
    expect(calledUrl(fetch.mock.calls[0])).toContain("search=Placeholder");
  });
});
