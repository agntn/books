import { describe, expect, it } from "vite-plus/test";
import { UnknownProviderError } from "../../src/core/errors.ts";
import {
  isAllProviders,
  providerArg,
  resolveProvider,
  selectProvider,
  usableProviders,
} from "../../src/core/resolve.ts";
import "../../src/providers/index.ts";

describe("providerArg", () => {
  it("treats empty and whitespace-only arguments as no preference", () => {
    expect(providerArg("  bn ")).toBe("bn");
    expect(providerArg("   ")).toBeUndefined();
    expect(providerArg(undefined)).toBeUndefined();
  });
});

describe("isAllProviders", () => {
  it("recognizes the reserved fan-out value in any casing", () => {
    expect(isAllProviders("all")).toBe(true);
    expect(isAllProviders(" ALL ")).toBe(true);
    expect(isAllProviders("bn")).toBe(false);
    expect(isAllProviders(undefined)).toBe(false);
  });
});

describe("usableProviders", () => {
  it("answers for operations and for result kinds alike", () => {
    expect(usableProviders("text")).toEqual(["gutendex", "wolnelektury"]);
    expect(usableProviders("isbn")).toEqual(["openlibrary", "bn"]);
    expect(usableProviders("ratings")).toEqual(["openlibrary", "lubimyczytac"]);
    expect(usableProviders("book")).toHaveLength(5);
  });
});

describe("resolveProvider", () => {
  it("picks the first provider that serves the operation", () => {
    expect(resolveProvider()).toBe("openlibrary");
    expect(resolveProvider(undefined, "text")).toBe("gutendex");
  });

  it("honours an explicit preference even when it cannot serve the operation", () => {
    // The caller then gets UnsupportedOperationError naming their own choice, rather than a
    // silent switch to a backend they did not ask for.
    expect(resolveProvider("bn", "text")).toBe("bn");
  });

  it("refuses a preference that is not registered", () => {
    expect(() => resolveProvider("goodreads")).toThrow(UnknownProviderError);
  });
});

describe("selectProvider", () => {
  it("returns a ready instance paired with its key", () => {
    const selected = selectProvider("  ", "text");
    expect(selected.name).toBe("gutendex");
    expect(selected.provider.name).toBe("gutendex");
  });
});
