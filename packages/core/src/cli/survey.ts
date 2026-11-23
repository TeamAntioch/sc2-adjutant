// Lists a Mission's Kept Content (ADR-0010), read from its Map Package each time and never stored,
// with Compiled Content marked from the compile record (src/map/survey.ts).
//
//   npm run survey -- <blueprint.json> [--kind unit,point,...] [--area <x0,y0,x1,y1 | region>] [--json]
//
// Paths are relative to where the command was typed.

import path from "node:path";

import { formatSurvey, surveyMission } from "../map/survey.js";
import { parseSurveyArgs } from "./survey-args.js";

async function main(): Promise<void> {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const { blueprintPath, options, json } = parseSurveyArgs(process.argv.slice(2));
  const survey = await surveyMission(path.resolve(cwd, blueprintPath), options);
  console.log(json ? JSON.stringify(survey, null, 2) : formatSurvey(survey).join("\n"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
