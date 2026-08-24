#!/usr/bin/env node

/** Books CLI - unified book catalog and full-text commands */
import { defineCommand, runMain } from "citty";
import { version } from "./version.ts";

/** Side-effect import: registers every built-in provider before the CLI parses arguments. */
import "./providers/index.ts";

const main = defineCommand({
  meta: {
    name: "books",
    version,
    description: "Unified book catalog CLI",
  },
  subCommands: {
    search: () => import("./commands/search.ts").then((m) => m.default),
    get: () => import("./commands/get.ts").then((m) => m.default),
    text: () => import("./commands/text.ts").then((m) => m.default),
    providers: () => import("./commands/providers.ts").then((m) => m.default),
    mcp: () => import("./commands/mcp.ts").then((m) => m.default),
  },
});

await runMain(main);
