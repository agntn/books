import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const root = fileURLToPath(new URL("../..", import.meta.url));

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== "BOOKS_DIST" && key !== "NODE_OPTIONS"),
);

/* Records the module URLs the child loaded into `file` on exit, since stderr would cut them. */
function recordLoads(file: string) {
  return `data:text/javascript,${encodeURIComponent(`
  import { writeFileSync } from "node:fs";
  import { registerHooks } from "node:module";
  const loaded = [];
  registerHooks({
    load(url, context, nextLoad) {
      loaded.push(url);
      return nextLoad(url, context);
    },
  });
  process.on("exit", () => writeFileSync(${JSON.stringify(file)}, JSON.stringify(loaded)));
`)}`;
}

const initialize = `${JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "books-test", version: "1.0.0" },
  },
})}\n`;

/* Which build the child loaded its MCP server from. */
function loadedFrom(base: string, loaded: unknown): "bundle" | "source" | "unknown" {
  const urls = Array.isArray(loaded) ? loaded.filter((url) => typeof url === "string") : [];
  if (!urls.includes(pathToFileURL(join(base, "dist/cli.mjs")).href)) return "unknown";
  return urls.includes(pathToFileURL(join(base, "src/mcp.ts")).href) ? "source" : "bundle";
}

/* Sends one initialize request to `mcp` from the bin in `base` and tells which build answered. */
function serve(
  base: string,
  options: Readonly<{ env?: Readonly<Record<string, string>>; flags?: readonly string[] }> = {},
) {
  const record = mkdtempSync(join(tmpdir(), "books-loaded-"));
  const file = join(record, "loaded.json");
  let child;
  let loaded: unknown = [];
  try {
    child = spawnSync(
      process.execPath,
      [...(options.flags ?? []), "--import", recordLoads(file), join(base, "dist/cli.mjs"), "mcp"],
      {
        encoding: "utf8",
        env: { ...env, ...options.env },
        input: initialize,
        timeout: 20_000,
      },
    );
    if (existsSync(file)) loaded = JSON.parse(readFileSync(file, "utf8"));
  } finally {
    rmSync(record, { recursive: true, force: true });
  }
  const { status, stderr, stdout } = child;
  const name = /"serverInfo":\{"name":"([^"]+)"/.exec(stdout)?.[1];
  return { code: status, from: loadedFrom(base, loaded), name, stderr };
}

/* The fields a run that answered the initialize request from `from` has to match. */
function served(from: "bundle" | "source") {
  return { code: 0, from, name: "books" };
}

describe.skipIf(!existsSync(join(root, "dist/cli.mjs")))("books mcp from the built bin", () => {
  it("serves the live source inside a checkout", () => {
    expect(serve(root)).toMatchObject(served("source"));
  });

  it("keeps the bundle under BOOKS_DIST=1", () => {
    expect(serve(root, { env: { BOOKS_DIST: "1" } })).toMatchObject(served("bundle"));
  });

  it("keeps the bundle when Node does not strip types", () => {
    expect(serve(root, { flags: ["--no-experimental-strip-types"] })).toMatchObject(
      served("bundle"),
    );
  });

  it("keeps the bundle when the package sits under node_modules", () => {
    const cache = join(root, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    const nested = mkdtempSync(join(cache, "books-cli-"));
    try {
      for (const entry of ["dist", "src", "package.json"]) {
        cpSync(join(root, entry), join(nested, entry), { recursive: true });
      }
      expect(serve(nested)).toMatchObject(served("bundle"));
    } finally {
      rmSync(nested, { recursive: true, force: true });
    }
  });

  it("keeps the bundle in a package that ships no src", () => {
    const packaged = mkdtempSync(join(tmpdir(), "books-cli-"));
    try {
      for (const entry of ["dist", "extensions", "package.json"]) {
        cpSync(join(root, entry), join(packaged, entry), { recursive: true });
      }
      symlinkSync(join(root, "node_modules"), join(packaged, "node_modules"), "dir");
      expect(serve(packaged)).toMatchObject(served("bundle"));
    } finally {
      rmSync(packaged, { recursive: true, force: true });
    }
  });
});

/* Runs `src/cli.ts` with one output stream closed before the first write, as after `| head -1`. */
async function closedPipe(closed: "stdout" | "stderr", ...args: readonly string[]) {
  const child = spawn(process.execPath, [join(root, "src/cli.ts"), ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  child[closed].destroy();
  let output = "";
  child[closed === "stdout" ? "stderr" : "stdout"]
    .setEncoding("utf8")
    .on("data", (chunk: string) => (output += chunk));
  await once(child, "close");
  return { code: child.exitCode, output };
}

describe("books with a closed pipe", () => {
  it("ends quietly when stdout closes", async () => {
    await expect(closedPipe("stdout", "providers")).resolves.toEqual({ code: 0, output: "" });
  });
});

describe("books get", () => {
  it("refuses a query that names no book in one line, before any request", () => {
    const run = spawnSync(process.execPath, [join(root, "src/cli.ts"), "get"], {
      encoding: "utf8",
      env,
      timeout: 10_000,
    });
    expect(run).toMatchObject({
      status: 1,
      stdout: "",
      stderr: "query needs one of isbn, id, or title\n",
    });
  });
});

describe("books search-text", () => {
  it("refuses provider all before any request, like the tool", () => {
    const run = spawnSync(
      process.execPath,
      [join(root, "src/cli.ts"), "search-text", "made-up phrase", "--provider", "all"],
      { encoding: "utf8", env, timeout: 10_000 },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("searchText reads one provider; leave provider empty");
  });
});

describe("books follow-text", () => {
  it("refuses provider all before any request, like the tool", () => {
    const run = spawnSync(
      process.execPath,
      [
        join(root, "src/cli.ts"),
        "follow-text",
        "made-up phrase",
        "--book",
        "placeholderscan",
        "--provider",
        "all",
      ],
      { encoding: "utf8", env, timeout: 10_000 },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("searchText reads one provider; leave provider empty");
  });
});

describe("books text", () => {
  it("refuses provider all before any request, like the tool", () => {
    const run = spawnSync(
      process.execPath,
      [join(root, "src/cli.ts"), "text", "Placeholder Novel", "--provider", "all"],
      { encoding: "utf8", env, timeout: 10_000 },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("text reads one provider; leave provider empty");
  });

  it("names a timeout and the library it never asked, instead of HTTP 0", () => {
    const timeOut = `data:text/javascript,${encodeURIComponent(
      'globalThis.fetch = async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };',
    )}`;
    const run = spawnSync(
      process.execPath,
      ["--import", timeOut, join(root, "src/cli.ts"), "text", "Placeholder Novel"],
      { encoding: "utf8", env, timeout: 10_000 },
    );
    expect(run).toMatchObject({
      status: 1,
      stdout: "",
      stderr:
        "No response from gutendex after 2 attempts (timed out after 15 s): https://gutendex.com/books/?search=Placeholder+Novel; not tried: wolnelektury; pass one as provider (-p in the CLI) or retry later\n",
    });
  });
});

/* Runs `src/cli.ts` with `args` and keeps what an error leaves behind. */
function refusal(...args: readonly string[]) {
  const run = spawnSync(process.execPath, [join(root, "src/cli.ts"), ...args], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  return { status: run.status, stderr: run.stderr };
}

describe("books short flags and loose words", () => {
  it.each([
    [["search", "dune", "herbert", "-n", "0"], "Invalid arguments at /limit: must be >= 1\n"],
    [["search", "dune", "herbert", "-p", "nope"], "Unknown provider: nope\n"],
    [["get", "Diuna", "-a", "Herbert", "-p", "nope"], "Unknown provider: nope\n"],
    [
      ["text", "Lalka", "-a", "Prus", "-o", "5", "-b", "10", "-p", "all"],
      "text reads one provider; leave provider empty\n",
    ],
    [
      ["search-text", "the", "spice", "must", "flow", "-n", "0"],
      "Invalid arguments at /limit: must be >= 1\n",
    ],
    [
      ["follow-text", "the", "spice", "must", "flow", "--book", "x", "-p", "all"],
      "searchText reads one provider; leave provider empty\n",
    ],
  ])("books %j reaches the tool before any request", (args, stderr) => {
    expect(refusal(...args)).toEqual({ status: 1, stderr });
  });
});
