import { createRequire } from "node:module";

/** Core's package version, which the server reports to its client and list_plugins names. */
export const CORE_VERSION = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;
