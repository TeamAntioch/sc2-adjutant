// A Blueprint's slug id (a Mission's, a Mod's, a Zone's …): lower-case letters, digits, hyphens
// and underscores, starting with a letter. Its own module so the schemas that share it don't import
// each other for it.

import { z } from "zod";

export const slugId = z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/, "Use lowercase letters, numbers, hyphens, or underscores");
