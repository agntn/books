import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  bookAll,
  bookWithFallback,
  searchAll,
  serializeOutcomes,
  textWithFallback,
} from "../../src/core/all.ts";
import {
  HTTPError,
  InvalidInputError,
  NotFoundError,
  RateLimitError,
} from "../../src/core/errors.ts";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { create, providers, register } from "../../src/core/registry.ts";
import type {
  Book,
  BookMatch,
  BookQuery,
  BookText,
  ProviderCapabilities,
} from "../../src/core/types.ts";
import "../../src/providers/index.ts";

/** Snapshot of the built-in registrations, so a test double can be handed back afterwards. */
const BUILT_INS = providers().map((name) => ({
  name,
  constructor: create(name).constructor as ProviderConstructor,
}));

function record(provider: string, title: string): Book {
  return { provider, title, authors: [], languages: [], subjects: [] };
}

/* A stand-in whose every operation fails the way the test needs. */
function failing(key: string, error: () => Error, capabilities?: Partial<ProviderCapabilities>) {
  return class Failing extends Provider {
    static readonly key: string = key;

    get capabilities(): ProviderCapabilities {
      return { search: true, book: true, text: true, isbn: true, ratings: false, ...capabilities };
    }

    async book(): Promise<Book> {
      throw error();
    }

    override async text(): Promise<BookText> {
      throw error();
    }

    override async search(): Promise<BookMatch[]> {
      throw error();
    }
  } as unknown as ProviderConstructor;
}

/* A stand-in that always answers. */
function working(key: string) {
  return class Working extends Provider {
    static readonly key: string = key;

    get capabilities(): ProviderCapabilities {
      return { search: true, book: true, text: true, isbn: true, ratings: false };
    }

    async book(query: BookQuery): Promise<Book> {
      return record(key, query.title ?? query.isbn ?? query.id ?? "");
    }

    override async text(): Promise<BookText> {
      return {
        provider: key,
        title: "",
        authors: [],
        text: "text",
        offset: 0,
        bytes: 4,
        truncated: false,
      };
    }

    override async search(): Promise<BookMatch[]> {
      return [{ title: "match", authors: [] }];
    }
  } as unknown as ProviderConstructor;
}

afterEach(() => {
  for (const entry of BUILT_INS) register(entry.constructor);
  vi.unstubAllGlobals();
});

describe("bookWithFallback", () => {
  it("walks providers until one has the book and records who was passed over", async () => {
    register(failing("openlibrary", () => new NotFoundError("nothing", "openlibrary")));
    register(working("gutendex"));

    const result = await bookWithFallback({ title: "placeholder" }, ["openlibrary", "gutendex"]);

    expect(result.provider).toBe("gutendex");
    expect(result.skipped).toEqual([{ provider: "openlibrary", error: "Not found: nothing" }]);
  });

  it("only visits catalogs that can resolve an ISBN", async () => {
    const walked: string[] = [];
    for (const name of ["openlibrary", "gutendex", "wolnelektury", "bn", "lubimyczytac"]) {
      register(
        class extends Provider {
          static readonly key: string = name;

          get capabilities(): ProviderCapabilities {
            const isbn = name === "openlibrary" || name === "bn";
            return { search: true, book: true, text: false, isbn, ratings: false };
          }

          async book(): Promise<Book> {
            walked.push(name);
            throw new NotFoundError(name, name);
          }
        } as unknown as ProviderConstructor,
      );
    }

    await expect(bookWithFallback({ isbn: "9780441013593" })).rejects.toThrow(NotFoundError);
    expect(walked).toEqual(["openlibrary", "bn"]);
  });

  it("passes over a backend that is down and says so in the result", async () => {
    // Gutendex answers 503 under load - seen minutes apart from a healthy response.
    register(
      failing("openlibrary", () => new HTTPError(503, "https://x.test", "busy", "openlibrary")),
    );
    register(working("bn"));

    const result = await bookWithFallback({ title: "placeholder" }, ["openlibrary", "bn"]);

    expect(result.provider).toBe("bn");
    expect(result.skipped[0]?.error).toContain("HTTP 503");
  });

  it("stops on a slow backend rather than spending every provider's timeout", async () => {
    register(
      failing("openlibrary", () => new HTTPError(0, "https://x.test", "timeout", "openlibrary")),
    );
    const second = vi.fn();
    register(
      class extends Provider {
        static readonly key: string = "bn";

        get capabilities(): ProviderCapabilities {
          return { search: true, book: true, text: false, isbn: true, ratings: false };
        }

        async book(): Promise<Book> {
          second();
          return record("bn", "never reached");
        }
      } as unknown as ProviderConstructor,
    );

    await expect(bookWithFallback({ title: "x" }, ["openlibrary", "bn"])).rejects.toThrow(
      HTTPError,
    );
    expect(second).not.toHaveBeenCalled();
  });

  it("stops on a rate limit, which retrying elsewhere would hide", async () => {
    register(failing("openlibrary", () => new RateLimitError("openlibrary", 30)));
    register(working("bn"));

    await expect(bookWithFallback({ title: "x" }, ["openlibrary", "bn"])).rejects.toThrow(
      RateLimitError,
    );
  });

  it("moves past a provider that does not understand another provider's id", async () => {
    register(failing("openlibrary", () => new InvalidInputError("id must be OL…W", "openlibrary")));
    register(working("gutendex"));

    const result = await bookWithFallback({ id: "84" }, ["openlibrary", "gutendex"]);
    expect(result.provider).toBe("gutendex");
  });

  it("validates the query once, before any provider is asked", async () => {
    const asked = vi.fn();
    register(
      class extends Provider {
        static readonly key: string = "openlibrary";

        get capabilities(): ProviderCapabilities {
          return { search: true, book: true, text: false, isbn: true, ratings: false };
        }

        async book(): Promise<Book> {
          asked();
          return record("openlibrary", "");
        }
      } as unknown as ProviderConstructor,
    );

    await expect(bookWithFallback({ author: "Herbert" })).rejects.toThrow(InvalidInputError);
    await expect(bookWithFallback({ isbn: "9780441013539" })).rejects.toThrow(InvalidInputError);
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("textWithFallback", () => {
  it("walks only the libraries that carry texts", async () => {
    const result = await textWithFallback({ title: "x" }, undefined, []).catch(
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(NotFoundError);

    register(working("gutendex"));
    const found = await textWithFallback({ title: "x" }, undefined, ["gutendex"]);
    expect(found.result.text).toBe("text");
  });
});

describe("fan-out", () => {
  it("collects every provider's answer, failures included", async () => {
    register(working("openlibrary"));
    register(failing("gutendex", () => new NotFoundError("nothing", "gutendex")));
    register(working("wolnelektury"));
    register(working("bn"));
    register(working("lubimyczytac"));

    const outcomes = await bookAll({ title: "placeholder" });
    const serialized = serializeOutcomes(outcomes);

    expect(serialized).toHaveLength(5);
    expect(serialized.find((entry) => entry.provider === "gutendex")?.error).toContain("Not found");
    expect(serialized.find((entry) => entry.provider === "bn")?.result).toMatchObject({
      title: "placeholder",
    });
  });

  it("searches every provider in parallel", async () => {
    register(working("openlibrary"));
    register(working("gutendex"));
    register(working("wolnelektury"));
    register(working("bn"));
    register(working("lubimyczytac"));

    const outcomes = await searchAll("placeholder", { limit: 1 });
    expect(outcomes.every((outcome) => outcome.result?.length === 1)).toBe(true);
  });
});
