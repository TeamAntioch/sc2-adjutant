// Freezes a set piece: writes the doodads it expands to into the blueprint as ordinary doodad
// anchors (exact positions, yaw and variation), and removes the set-piece placement, so single
// doodads can be moved or swapped by hand or in the Editor.
//
//   npm run freeze-set-piece -- missions/<id>/blueprint.json <set-piece id>

import { freezeMissionSetPiece } from "../dressing/mission-dressing-edits.js";
import { formatIssue, workspaceFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const [blueprintPath, setPieceId] = process.argv.slice(2);
  if (!blueprintPath || !setPieceId) {
    console.error("Usage: freeze-set-piece <blueprint.json> <set-piece id>");
    process.exitCode = 2;
    return;
  }
  const { frozen, edit } = await freezeMissionSetPiece(await workspaceFor(blueprintPath), blueprintPath, setPieceId);
  if (!edit.saved) throw new Error(`The frozen blueprint doesn't validate, so ${blueprintPath} is unchanged: ${edit.issues.map(formatIssue).join("; ")}`);
  console.log(`Froze ${setPieceId} into ${frozen} doodad anchors in ${blueprintPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
