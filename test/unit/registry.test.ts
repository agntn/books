import { afterEach, describe, expect, it } from "vite-plus/test";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { UnknownProviderError, UnsupportedOperationError } from "../../src/core/errors.ts";
import { requireOperation } from "../../src/core/provider.ts";
import {
  create,
  getDefaultURL,
  getEnvKey,
  has,
  isConfigured,
  listProviders,
  providers,
  register,
  supportsOperation,
} from "../../src/core/registry.ts";
import type { Book, ProviderCapabilities } from "../../src/core/types.ts";
import "../../src/providers/index.ts";

/** Claims an operation it never implemented, to prove the capability gate is not decorative. */
class Liar extends Provider {
  static readonly key: string = "liar";

  get capabilities(): ProviderCapabilities {
    return { search: true, book: true, text: true, isbn: false, ratings: false };
  }

  async book(): Promise<Book> {
    return {
      provider: Liar.key,
      title: "",
      authors: [],
      languages: [],
      subjects: [],
    };
  }
}

/** Needs a credential, so it takes part in configuration-aware listing. */
class Keyed extends Liar {
  static override readonly key = "keyed";
  static readonly envKey = "BOOKS_TEST_KEY";
}

afterEach(() => {
  delete process.env.BOOKS_TEST_KEY;
});

describe("registry", () => {
  it("registers the built-in providers in fallback order", () => {
    expect(providers()).toEqual(["openlibrary", "gutendex", "wolnelektury", "bn", "lubimyczytac"]);
  });

  it("answers for names, endpoints and capabilities without constructing a request", () => {
    expect(has("openlibrary")).toBe(true);
    expect(has("nothing")).toBe(false);
    expect(getDefaultURL("gutendex")).toBe("https://gutendex.com");
    expect(supportsOperation("gutendex", "text")).toBe(true);
    expect(supportsOperation("bn", "text")).toBe(false);
    expect(supportsOperation("nothing", "book")).toBe(false);
  });

  it("refuses to create an unregistered provider", () => {
    expect(() => create("nothing")).toThrow(UnknownProviderError);
  });

  it("treats a keyless provider as configured and a keyed one only with its variable", () => {
    register(Keyed as unknown as ProviderConstructor);
    expect(getEnvKey("openlibrary")).toBeUndefined();
    expect(isConfigured("openlibrary")).toBe(true);
    expect(isConfigured("keyed")).toBe(false);

    process.env.BOOKS_TEST_KEY = "set";
    expect(isConfigured("keyed")).toBe(true);

    const listing = listProviders().find((entry) => entry.name === "keyed");
    expect(listing).toMatchObject({ envKey: "BOOKS_TEST_KEY", configured: true });
  });

  it("stops a provider that advertises an operation it never implemented", () => {
    register(Liar as unknown as ProviderConstructor);
    expect(() => requireOperation(create("liar"), "text")).toThrow(UnsupportedOperationError);
  });
});
