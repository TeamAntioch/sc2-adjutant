// Type-checks a Galaxy file against the game's natives with plaxtony, which the Editor's compiler
// roughly agrees with. Only natives are known, so a script must not call library functions (libNtve_*).
//   node tools/check-galaxy.cjs <file.galaxy>
// PLAXTONY: plaxtony's package folder (npm install plaxtony@1.10.5 --ignore-scripts somewhere private).
// NATIVES: a folder holding natives.galaxy and natives_missing.galaxy (core.sc2mod's TriggerLibs).
const path = require('path');
const fs = require('fs');
const P = process.env.PLAXTONY;
const N = process.env.NATIVES;
if (!P || !N) {
  console.error('Set PLAXTONY (plaxtony\'s package folder) and NATIVES (the folder holding natives.galaxy)');
  process.exit(2);
}
const {Store, createTextDocumentFromFs} = require(path.join(P, 'lib/src/service/store'));
const {TypeChecker} = require(path.join(P, 'lib/src/compiler/checker'));
const file = path.resolve(process.argv[2]);
const store = new Store();
for (const f of [path.join(N, 'natives.galaxy'), path.join(N, 'natives_missing.galaxy'), file]) {
  if (fs.existsSync(f)) store.updateDocument(createTextDocumentFromFs(f));
}
const target = [...store.documents.values()].find(d => d.fileName === file || d.fileName.endsWith(path.basename(file)));
const diags = [...(target.parseDiagnostics || []), ...new TypeChecker(store).checkSourceFile(target, true)];
const text = fs.readFileSync(file, 'utf8');
for (const d of diags) console.log(`line ${text.slice(0, d.start).split('\n').length}: ${d.messageText}`);
console.log(diags.length + ' problems');
process.exit(diags.length ? 1 : 0);
