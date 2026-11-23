// The survey CLI's arguments (survey.ts): the Blueprint, --kind and --area to narrow the listing
// (src/map/survey.ts), and --json for the survey as data.

import { type SurveyKind, type SurveyOptions, surveyKind } from "../map/survey.js";

export const SURVEY_USAGE = "Usage: survey <blueprint.json> [--kind <kind>[,<kind>]...]... [--area <x0,y0,x1,y1> | --area <region name or id>] [--json]";

export type SurveyArgs = { readonly blueprintPath: string; readonly options: SurveyOptions; readonly json: boolean };

export function parseSurveyArgs(argv: readonly string[]): SurveyArgs {
  const positional: string[] = [];
  const kinds: SurveyKind[] = [];
  let area: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--kind" || arg === "--area") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value. ${SURVEY_USAGE}`);
      if (arg === "--kind") kinds.push(...value.split(",").map((kind) => surveyKind(kind.trim())));
      else if (!value.trim()) throw new Error(`--area can't be empty: give a region's name or id, or x0,y0,x1,y1. ${SURVEY_USAGE}`);
      else area = value;
    } else if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}. ${SURVEY_USAGE}`);
    } else {
      positional.push(arg);
    }
  }
  const [blueprintPath] = positional;
  if (!blueprintPath || positional.length > 1) throw new Error(SURVEY_USAGE);
  return { blueprintPath, options: { ...(kinds.length ? { kinds } : {}), ...(area !== undefined ? { area } : {}) }, json };
}
