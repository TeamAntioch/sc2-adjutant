# Set Finder

Ask for a cinematic set in plain words ("a cramped ship corridor with a cockpit at one end") and see the sets that fit, best first. Spec: #726; on the published package since #802.

The Set Finder is the public [`@team-antioch/sc2-set-finder`](https://github.com/TeamAntioch/sc2-asset-catalog/tree/main/packages/sc2-set-finder), pinned in `package.json` (see [docs/agents/asset-catalog.md](../../docs/agents/asset-catalog.md)). Its cards, narrowing (a keyword search and the local embeddings model, merged), Jev ranking, page and test asks are there. This package is sc2-adjutant's wrapper over it: it lays this machine's own sets over the published ones, and serves `find_sets`.

```
npm run set-finder -- [--port n] [--budget dollars] [--views <dir>] [--looks <file>] [--workspace <dir>] [--open]
```

The page is at `http://127.0.0.1:4636/` unless `--port` says otherwise. With nothing asked it lists every set by name.

## Which sets it shows

- **The published sets.** Blizzard's sets alone, from the catalog's `data/set-looks.json`, with their pictures linked from the sc2-mapping-reference gallery. They come with the pinned release, so the page needs a connection for their pictures.
- **This machine's own sets, laid over them** (`src/sets.ts`). These are the described sets the published package doesn't carry:
  - the Workspace's own sets, which a file of its Campaign's holds, and which `publicSets` (core's `src/capture/export-sets.ts`) leaves out of the public catalog. The Workspace's `cinematic-sets/` folder has their looks (`looks.json`) and catalog (`catalog.json`, written by `npm run catalog-sets -- ... --private`). The Workspace is the one `--workspace` names, else the one holding the folder the command is run from; `find_sets` takes the server's;
  - any public set described since the release, until a release carries it. Core's `data/cinematic-sets` has Blizzard's sets alone: their looks (`looks.json`, or `--looks`) and catalog.

  Each is a layer of the package's `setCards`. Its look comes from its `looks.json`, its size and cameras from its drawing, and its files from the catalog beside it. Where core and the Workspace both have a set, the Workspace's is used. Its pictures are in the views folder (`--views`, the cache folder's `set-views/` by default), which the page serves. A card names its set's sources, Blizzard's first and the rest in alphabetical order, such as "Blizzard campaign, My Campaign". A source other than Blizzard's is named by the `label` the Workspace's Plugins give it in their `cutsceneSources`, or by its id where none does. On a machine with no cache folder set (and no `--views`), the page has the published sets alone and says why.
- **A published set keeps its published card**, even where core's `looks.json` has a newer look of it, and even when it has since been found in a file that isn't Blizzard's. A change to a public set's look reaches the page with a release: `npm run export-sets` writes the public looks into an sc2-asset-catalog checkout for a pull request there.

## What it needs

- **Drawn sets, for this machine's own.** `npm run render-set-views` draws each set into the cache folder's `set-views/` (see `docs/reference/m3-models-in-blender.md`), and `npm run set-cards` makes the card pictures the looks name, and their in-game frames where the captures are (#790). A set with no `set.json` there has no card of its own. A card shows the pictures it has, and the plan and overview always. `docs/agents/describing-sets.md` is how a look is written.
- **A Jev key, for ranking.** The finders' key: `TYPESAFE_API_KEY`, else the key file `npx @team-antioch/sc2-set-finder login` saves. With none, the page shows the narrowing's order and says so. An ask costs about $0.0005; a session stops calling Jev at `--budget` ($1 unless given).

The vectors (`sets-vectors-*.json`), payload logs (`ranker-payloads/set-finder-*.jsonl`, `find-sets-*.jsonl`) and page settings are in the package's cache folder, as the Doodad Finder's are.

## Testing it

The test asks are the package's: `npm run test-set-asks` in sc2-asset-catalog runs them on the published sets. This package's tests (`npm run turbo -- run test --filter=@team-antioch/sc2-adjutant-set-finder`, from the repo root, which builds what they need first) check the layers and `find_sets` with made-up sets, a fake embedder and a fake Jev.

## For agents

`src/find-sets.ts` is the `find_sets` MCP tool. Core's server loads it when this package is installed (`packages/core/src/mcp/find-sets.ts`): core lists it as an optional dependency and finds it by its name, `@team-antioch/sc2-adjutant-set-finder`. It serves the package's narrowing and ranking over the same cards as the page, each set with its chosen pictures to read. A laid-over set's pictures are files in the views folder. A published set's are too where this machine drew the same picture (core's `looks.json` names the file with the caption the release gives); otherwise they are its gallery addresses. The cinematography skill asks it for candidate sets.
