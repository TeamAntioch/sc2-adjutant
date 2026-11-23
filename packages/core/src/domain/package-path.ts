// A path inside a Map Package or mod package, as the compile record and a Blueprint's strings name
// one. On its own so the library interface can hold strings without reaching the compile record,
// which imports it.

import { z } from "zod";

/** A path inside the Map Package or mod package, with forward slashes. */
export const PackagePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), "A package path is relative and stays inside the package");
