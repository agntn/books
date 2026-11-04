import pkg from "../package.json" with { type: "json" };

/** Read from `package.json`, the one file a release PR bumps. */
export const version: string = pkg.version;
