// Input schemas and a reply helper that several tool groups share.

import { z } from "zod";

export const MissionSchema = z.string().min(1).describe("The Mission's folder name in the Workspace's missions folder");

/** A value with its readonly arrays and fields made plain, to return as a tool's structured output. */
export type Plain<T> = T extends readonly (infer Item)[] ? Plain<Item>[] : T extends object ? { -readonly [Key in keyof T]: Plain<T[Key]> } : T;
export const plain = <T>(value: T): Plain<T> => structuredClone(value) as Plain<T>;

export const IssueSchema = z.object({ path: z.string(), message: z.string() });
export const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

export const MapSchema = z.string().min(1).optional().describe("The Map Package: a folder inside the Workspace, relative to its root. By default the Mission's committed package, <mission folder>/<Name>.SC2Map");

/** A list of ids: tilesets' textures, cliff sets, lights and the like. */
export const Ids = z.array(z.string());
