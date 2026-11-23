// Asset Sources (ADR-0011): where each of an Asset Mod's files comes from, as its Mod Blueprint
// declares it. The tooling can't author a model or record a voice, so an Asset Mod is assembled:
//
//   { file, sha256, origin? }                a Workspace file in the mod's folder, in Git LFS, with
//                                            its SHA-256 (the hash Git LFS stores it by), and where
//                                            its content came from when that isn't the team's own
//                                            work: a port of another game's asset, or a community
//                                            asset kept in the Workspace, credited
//   { url, version, licence, sha256,         a community asset, fetched to the machine's cache and
//     member? }                              never committed, its licence on the record; with a
//                                            member, one file inside the downloaded zip (the
//                                            SHA-256 is the archive's)
//   { generated: "tts", sound }              a placeholder voice for a Sound ID, spoken in the voice
//                                            its character declares; made on each machine, never committed
//   { derived: "wav-to-ogg", from }          a file made from another Asset Source by a named step
//
// `voices` declares a conversation's voice files at once: one per line, the recording when there
// is one, else a placeholder (a recording wins over a generated placeholder).

import path from "node:path";

import { z } from "zod";

import { CatalogId } from "./mod-screenplay.js";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "A SHA-256 is 64 lower-case hex digits");

/** The named steps a derived Asset Source can be made by. */
export const DERIVE_STEPS = ["wav-to-ogg"] as const;
export type DeriveStep = (typeof DERIVE_STEPS)[number];

/**
 * Where a Workspace file's content came from, when it isn't the team's own work. Provenance only:
 * the file is still made from the Workspace. A port is another game's asset brought into SC2 by
 * someone (`of` the game, `owner` its rights holder, `by` who ported it); a community asset is one
 * published by `credit`, on `site` at `url` when known, whose file is kept in the Workspace since
 * there's nothing to fetch it from (a community asset with an address is its own Asset Source).
 */
export const OriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("port"), of: z.string().min(1), owner: z.string().min(1), by: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("community"), credit: z.string().min(1), site: z.string().min(1).optional(), url: z.url({ protocol: /^https?$/ }).optional() }).strict(),
]);
export type Origin = z.infer<typeof OriginSchema>;

/** A file kept in the Workspace: in the mod's folder, relative to it, with its SHA-256, and its origin when it isn't the team's own. */
const WorkspaceFileSchema = z
  .object({
    file: z
      .string()
      .min(1)
      .refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes(".."), "A Workspace file is in the mod's folder, relative to it"),
    sha256: Sha256,
    origin: OriginSchema.optional(),
  })
  .strict();

/**
 * A community asset: where it's published, which version, under which licence, and its SHA-256, so
 * a changed download is refused. A pack that downloads as a zip (as CurseForge's do) names the
 * file inside it as `member`, its path in the archive; the SHA-256 is then the archive's.
 */
const CommunityAssetSchema = z
  .object({
    url: z.url({ protocol: /^https?$/ }),
    version: z.string().min(1),
    licence: z.string().min(1),
    sha256: Sha256,
    member: z
      .string()
      .min(1)
      .refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.endsWith("/"), "An archive member is a file's path in the archive, with forward slashes")
      .optional(),
  })
  .strict();

/** A placeholder generated for a Sound ID: text-to-speech of its line, in its character's voice. */
const GeneratedSchema = z.object({ generated: z.literal("tts"), sound: CatalogId }).strict();

export type WorkspaceFileSource = z.infer<typeof WorkspaceFileSchema>;
export type CommunityAssetSource = z.infer<typeof CommunityAssetSchema>;
export type GeneratedSource = z.infer<typeof GeneratedSchema>;
export type DerivedSource = { readonly derived: DeriveStep; readonly from: AssetSource };
export type AssetSource = WorkspaceFileSource | CommunityAssetSource | GeneratedSource | DerivedSource;

export const AssetSourceSchema: z.ZodType<AssetSource> = z.lazy(() =>
  z.union([WorkspaceFileSchema, CommunityAssetSchema, GeneratedSchema, z.object({ derived: z.enum(DERIVE_STEPS), from: AssetSourceSchema }).strict()]),
);

export const isWorkspaceFile = (source: AssetSource): source is WorkspaceFileSource => "file" in source;
export const isCommunityAsset = (source: AssetSource): source is CommunityAssetSource => "url" in source;
export const isGenerated = (source: AssetSource): source is GeneratedSource => "generated" in source;
export const isDerived = (source: AssetSource): source is DerivedSource => "derived" in source;

/**
 * Whether a file made from `source` is committed with the package: only one made from Workspace
 * files alone. A community asset stays out of git so its licence governs it, and a placeholder is
 * made on each machine.
 */
export const isCommitted = (source: AssetSource): boolean => (isDerived(source) ? isCommitted(source.from) : isWorkspaceFile(source));

/** The extension (lower case, without the dot) of the file `source` makes: its own file's, archive member's or URL's, wav for a placeholder, or its step's. */
export function madeFormat(source: AssetSource): string {
  if (isDerived(source)) return DERIVED_FORMATS[source.derived];
  if (isGenerated(source)) return "wav";
  const name = isWorkspaceFile(source) ? source.file : (source.member ?? new URL(source.url).pathname);
  return path.extname(name).slice(1).toLowerCase();
}

/** The format each named step makes. */
const DERIVED_FORMATS: Record<DeriveStep, string> = { "wav-to-ogg": "ogg" };

/** The Workspace files `source` is made from. */
export const workspaceFilesOf = (source: AssetSource): WorkspaceFileSource[] => (isDerived(source) ? workspaceFilesOf(source.from) : isWorkspaceFile(source) ? [source] : []);

/** A path inside the mod package, with forward slashes. */
const PackagePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "A package path is relative, with forward slashes, and stays inside the package");

/** One file of the Asset Mod and its Asset Source. */
export const AssetFileSchema = z.object({ path: PackagePath, source: AssetSourceSchema }).strict();
export type AssetFile = z.infer<typeof AssetFileSchema>;

export const VOICE_FORMATS = ["ogg", "wav"] as const;

/**
 * A conversation's voice files: for each of its lines (in `groups`, or all), `<folder>/<Sound>.<format>`,
 * from its recording, else a placeholder generated in its character's voice (derived to .ogg for an
 * ogg folder). The conversation is one a Screenplay of the Workspace's Campaign Mod compiles into,
 * which gives each line's Sound, text and speaker.
 */
export const VoicesSchema = z
  .object({
    conversation: CatalogId,
    /** The scenes (Group0000N) whose lines are voiced here; all of them when left out. */
    groups: z.array(z.number().int().positive()).min(1).optional(),
    /** Where the voice files go in the package, such as Base.SC2Assets/Assets/Sounds/Conversations. */
    folder: PackagePath,
    format: z.enum(VOICE_FORMATS).default("ogg"),
    /** Each recorded line's Asset Source, by its Sound ID, in the folder's format; a line with none gets a placeholder, and one whose Workspace file a machine doesn't have keeps the package's file. */
    recordings: z.record(CatalogId, AssetSourceSchema).default({}),
  })
  .strict()
  .superRefine((voices, context) => {
    // A recording's bytes go in as they are, so it must already be in the folder's format.
    for (const [sound, source] of Object.entries(voices.recordings)) {
      const made = madeFormat(source);
      if (made === voices.format) continue;
      const convert = voices.format === "ogg" && made === "wav" ? `give it as { "derived": "wav-to-ogg", "from": <the recording> }` : `record it as a .${voices.format} file`;
      context.addIssue({ code: "custom", path: ["recordings", sound], message: `${sound}'s recording makes a .${made || "(no extension)"} file, not the voices' .${voices.format}: ${convert}` });
    }
  });
export type Voices = z.infer<typeof VoicesSchema>;
