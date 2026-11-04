import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const root = fileURLToPath(new URL("../..", import.meta.url));

const read = (path: string) => readFileSync(join(root, path), "utf8");

const sources = globSync(["src/**/*.ts", "extensions/**/*.ts", "test/**/*.ts"], { cwd: root });

/** Characters below a space that a source file has any business holding. */
const LAYOUT = new Set(["\n", "\r", "\t"]);

/* The first raw control character in `text`, as its code, or `undefined` when there is none. */
function controlCharacter(text: string): number | undefined {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 32 && !LAYOUT.has(character)) || code === 127) return code;
  }
  return undefined;
}

describe("the package", () => {
  /** Providers register on import, so `sideEffects: false` lets a bundler drop every one. */
  it("never declares itself free of side effects", () => {
    const manifest = JSON.parse(read("package.json")) as { sideEffects?: unknown };

    expect(manifest.sideEffects).not.toBe(false);
  });
});

describe("source files", () => {
  it("finds the sources", () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  /** A raw byte where an escape was meant still runs, but git calls the file binary and hides it. */
  it.each(sources)("spells control characters in %s as escapes", (path) => {
    expect(controlCharacter(read(path))).toBeUndefined();
  });
});
