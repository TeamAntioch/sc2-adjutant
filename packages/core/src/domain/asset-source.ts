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
//   { game, member? }                        a stock file from the game: the model at `game`, or
//                                            the texture it names as `member`, exported by the
//                                            machine's Host Adapter (model.export); made on each
//                                            machine, never committed (ADR-0027)
//   { derived: "wav-to-ogg", from }          a file made from another Asset Source by a named step:
//   { derived: "retexture", from, textures } wav-to-ogg encodes with ffmpeg; retexture points an
//   { derived: "recolour", from, hue |       .m3's texture paths at other files; recolour shifts a
//     gradient, saturation?, lightness? }    .dds texture's hue or maps its greyscale onto a gradient
//
// `voices` declares a conversation's voice files at once: one per line, the recording when there
// is one, else a placeholder (a recording wins over a generated placeholder).

import path from "node:path";

import { z } from "zod";

import { CatalogId } from "./mod-screenplay.js";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "A SHA-256 is 64 lower-case hex digits");

/** The named steps a derived Asset Source can be made by. */
export const DERIVE_STEPS = ["wav-to-ogg", "retexture", "recolour"] as const;
export type DeriveStep = (typeof DERIVE_STEPS)[number];
/** The steps the machine's ffmpeg makes (host/derive.ts); the others are core's own. */
export type EncodeStep = "wav-to-ogg";

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

/** A storage path in the game, as a model names its textures: `Assets/Effects/x/x.m3`, either slash. */
const StoragePath = z
  .string()
  .min(1)
  .refine((value) => /^assets[\\/]/i.test(value) && !value.split(/[\\/]/).includes(".."), "A game file's path starts Assets/, as the game stores it");

/**
 * A stock file from the game: the model at `game` (an .m3 storage path), with its animations
 * merged in, or, as `member`, one texture that model names, as the machine's Host Adapter exports
 * them (model.export). Blizzard's files stay out of git: each machine exports its own.
 */
const GameFileSchema = z
  .object({
    game: StoragePath.refine((value) => /\.m3$/i.test(value), "A game file's `game` is a model, an .m3; a texture is the `member` of a model that names it"),
    member: StoragePath.optional(),
  })
  .strict();

export type GameFileSource = z.infer<typeof GameFileSchema>;
export type WorkspaceFileSource = z.infer<typeof WorkspaceFileSchema>;
export type CommunityAssetSource = z.infer<typeof CommunityAssetSchema>;
export type GeneratedSource = z.infer<typeof GeneratedSchema>;
/** A file encoded from another by the machine's ffmpeg. */
export type EncodedSource = { readonly derived: EncodeStep; readonly from: AssetSource };
/** An .m3 from another, with the texture paths it names as keys of `textures` pointed at their values (storage paths). */
export type RetextureSource = { readonly derived: "retexture"; readonly from: AssetSource; readonly textures: Readonly<Record<string, string>> };
/** How a recolour changes a texture: a hue shift, or its greyscale mapped onto a gradient. */
export type Recolour = {
  /** Degrees round the colour wheel to turn each texel's hue. */
  readonly hue?: number | undefined;
  /** Colours (#rrggbb) from dark to light, evenly spaced, that each texel's brightness is mapped onto; its alpha is kept. */
  readonly gradient?: readonly string[] | undefined;
  /** With `hue`: a factor on each texel's saturation (1 keeps it). */
  readonly saturation?: number | undefined;
  /** With `hue`: a factor on each texel's lightness (1 keeps it). */
  readonly lightness?: number | undefined;
};
/** A .dds texture from another, recoloured. */
export type RecolourSource = { readonly derived: "recolour"; readonly from: AssetSource } & Recolour;
export type DerivedSource = EncodedSource | RetextureSource | RecolourSource;
export type AssetSource = WorkspaceFileSource | CommunityAssetSource | GeneratedSource | GameFileSource | DerivedSource;

const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A gradient's colour is #rrggbb");

export const AssetSourceSchema: z.ZodType<AssetSource> = z.lazy(() =>
  z.union([
    WorkspaceFileSchema,
    CommunityAssetSchema,
    GeneratedSchema,
    GameFileSchema,
    z.object({ derived: z.literal("wav-to-ogg"), from: AssetSourceSchema }).strict(),
    z
      .object({ derived: z.literal("retexture"), from: AssetSourceSchema, textures: z.record(StoragePath, StoragePath) })
      .strict()
      .superRefine((source, context) => {
        const made = madeFormat(source.from);
        if (made !== "m3") context.addIssue({ code: "custom", path: ["from"], message: `retexture points an .m3's texture paths elsewhere, but its source makes a .${made || "(no extension)"} file` });
        if (Object.keys(source.textures).length === 0) context.addIssue({ code: "custom", path: ["textures"], message: "retexture names at least one texture the model names, and the file it draws instead" });
        const seen = new Map<string, string>();
        for (const key of Object.keys(source.textures)) {
          const other = seen.get(sameStoragePath(key));
          if (other) context.addIssue({ code: "custom", path: ["textures", key], message: `${other} and ${key} are one texture: name it once` });
          seen.set(sameStoragePath(key), key);
        }
      }),
    z
      .object({
        derived: z.literal("recolour"),
        from: AssetSourceSchema,
        hue: z.number().min(-360).max(360).optional(),
        gradient: z.array(Colour).min(2).max(16).optional(),
        saturation: z.number().min(0).max(4).optional(),
        lightness: z.number().min(0).max(4).optional(),
      })
      .strict()
      .superRefine((source, context) => {
        const made = madeFormat(source.from);
        if (made !== "dds") context.addIssue({ code: "custom", path: ["from"], message: `recolour changes a .dds texture, but its source makes a .${made || "(no extension)"} file` });
        const hueMode = source.hue !== undefined || source.saturation !== undefined || source.lightness !== undefined;
        if (hueMode === (source.gradient !== undefined)) {
          context.addIssue({ code: "custom", path: [], message: "recolour takes a hue shift (hue, with saturation and lightness if wanted) or a gradient, not both and not neither" });
        }
      }),
  ]),
);

/** A storage path to compare: one slash, any case, as the game matches it. */
export const sameStoragePath = (storagePath: string): string => storagePath.replace(/\\/g, "/").toLowerCase();

export const isWorkspaceFile = (source: AssetSource): source is WorkspaceFileSource => "file" in source;
export const isCommunityAsset = (source: AssetSource): source is CommunityAssetSource => "url" in source;
export const isGenerated = (source: AssetSource): source is GeneratedSource => "generated" in source;
export const isGameFile = (source: AssetSource): source is GameFileSource => "game" in source;
export const isDerived = (source: AssetSource): source is DerivedSource => "derived" in source;
export const isEncoded = (source: AssetSource): source is EncodedSource => isDerived(source) && source.derived === "wav-to-ogg";

/**
 * Whether a file made from `source` is committed with the package: only one made from Workspace
 * files alone. A community asset stays out of git so its licence governs it, a game file is
 * Blizzard's, and a placeholder is made on each machine.
 */
export const isCommitted = (source: AssetSource): boolean => (isDerived(source) ? isCommitted(source.from) : isWorkspaceFile(source));

/** The extension (lower case, without the dot) of the file `source` makes: its own file's, archive member's or URL's, wav for a placeholder, its game file's, or its step's. */
export function madeFormat(source: AssetSource): string {
  if (isDerived(source)) return DERIVED_FORMATS[source.derived];
  if (isGenerated(source)) return "wav";
  if (isGameFile(source)) return path.extname(source.member ?? source.game).slice(1).toLowerCase();
  const name = isWorkspaceFile(source) ? source.file : (source.member ?? new URL(source.url).pathname);
  return path.extname(name).slice(1).toLowerCase();
}

/** The format each named step makes. */
const DERIVED_FORMATS: Record<DeriveStep, string> = { "wav-to-ogg": "ogg", retexture: "m3", recolour: "dds" };

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
