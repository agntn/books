import { describe, expect, it } from "vite-plus/test";
import { InvalidInputError } from "../../src/core/errors.ts";
import {
  assertIsbn,
  isIsbn,
  isIsbn10,
  isIsbn13,
  isbn10To13,
  isbn13To10,
  normalizeIsbn,
  toIsbn10,
  toIsbn13,
} from "../../src/core/isbn.ts";

describe("normalizeIsbn", () => {
  it("strips separators, spaces and the ISBN label", () => {
    expect(normalizeIsbn("ISBN 978-83-288-3733-1")).toBe("9788328837331");
    expect(normalizeIsbn("isbn-13: 978 0441 013593")).toBe("9780441013593");
  });

  it("keeps the X check character of an ISBN-10", () => {
    expect(normalizeIsbn("80-85983-16-x")).toBe("808598316X");
  });
});

describe("isIsbn10", () => {
  it("accepts a valid number, including one checked by X", () => {
    expect(isIsbn10("0441013597")).toBe(true);
    expect(isIsbn10("0-8044-2957-X")).toBe(true);
  });

  it("rejects a wrong check digit and a wrong length", () => {
    expect(isIsbn10("0441013598")).toBe(false);
    expect(isIsbn10("044101359")).toBe(false);
  });
});

describe("isIsbn13", () => {
  it("accepts a valid number", () => {
    expect(isIsbn13("9780441013593")).toBe(true);
    expect(isIsbn13("978-83-7578-063-5")).toBe(true);
  });

  it("rejects a mistyped digit", () => {
    // A single transposed pair is exactly the failure the check digit exists to catch.
    expect(isIsbn13("9780441013539")).toBe(false);
  });

  it("rejects a thirteen-digit number whose check digit does not add up", () => {
    expect(isIsbn13("1234567890123")).toBe(false);
    expect(isIsbn("978044101359")).toBe(false);
  });

  it("judges a number by its check digit, not by whether it looks real", () => {
    // All zeroes satisfies the checksum, so it passes although no publisher issued it, while
    // thirteen nines does not - and Open Library holds a record filed under exactly that
    // number. Catalogs store what cataloguers typed; validation here catches the caller's typo.
    expect(isIsbn13("0000000000000")).toBe(true);
    expect(isIsbn13("9999999999999")).toBe(false);
  });
});

describe("isbn10To13", () => {
  it("prefixes 978 and recomputes the check digit", () => {
    expect(isbn10To13("0441013597")).toBe("9780441013593");
    expect(isbn10To13("8375780634")).toBe("9788375780635");
  });

  it("refuses an invalid ISBN-10", () => {
    expect(() => isbn10To13("0441013598")).toThrow(InvalidInputError);
  });
});

describe("isbn13To10", () => {
  it("drops the 978 prefix and recomputes the check digit, X included", () => {
    expect(isbn13To10("9780441013593")).toBe("0441013597");
    expect(isbn13To10("978-83-7054-091-3")).toBe("8370540910");
    expect(isbn13To10("9780804429573")).toBe("080442957X");
  });

  it("answers undefined for a 979 number, which has no ten-digit form", () => {
    expect(isbn13To10("9791090636071")).toBeUndefined();
  });

  it("refuses an invalid ISBN-13", () => {
    expect(() => isbn13To10("9780441013539")).toThrow(InvalidInputError);
  });
});

describe("toIsbn13 and toIsbn10", () => {
  it("normalizes either length onto thirteen digits", () => {
    expect(toIsbn13("0441013597")).toBe("9780441013593");
    expect(toIsbn13("978-0-441-01359-3")).toBe("9780441013593");
  });

  it("answers undefined rather than guessing", () => {
    expect(toIsbn13(undefined)).toBeUndefined();
    expect(toIsbn13("not an isbn")).toBeUndefined();
    expect(toIsbn10("9780441013593")).toBeUndefined();
  });
});

describe("assertIsbn", () => {
  it("returns the normalized number", () => {
    expect(assertIsbn("978-0-441-01359-3", "openlibrary")).toBe("9780441013593");
  });

  it("names the provider when the check digit fails", () => {
    expect(() => assertIsbn("9780441013539", "openlibrary")).toThrow(InvalidInputError);
    expect(() => assertIsbn("9780441013539", "openlibrary")).toThrow(/not a valid ISBN/);
  });
});
