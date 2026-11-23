#!/usr/bin/env python3
"""Prepares Heroes of the Storm effect models for the effect tour (npm run effect-tour -- make --folder).

Extracts the effect models a regex picks from a Heroes install with a CASC extractor (stormex, as
$SC2_CASC_TOOL), extracts the textures they name, and converts each model for StarCraft II with
WhiteoutFlakes (--save-m3-sc2). Writes each model under <out>/Assets/Effects/HotS/ at its own path
below Assets/Effects, and <out>/Assets/Textures/<texture>, the paths the tour imports them at.

  python3 -I tools/effects/prepare-hots-effects.py --out <folder> [--only <regex>] [--base-only]
      [--sample <n>] [--seed <n>] [--hots "/Applications/Heroes of the Storm"]
      [--viewer <WhiteoutFlakes>] [--workers 4]

--base-only keeps a hero's base effects (_Base_ in the name), not their skins' versions.
"""
import argparse
import concurrent.futures
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading

DDS = re.compile(rb"[A-Za-z0-9_\\/ .-]+\.dds", re.I)


def run(cmd, timeout=None, env=None):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, -1, "", f"timed out after {timeout} s")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--only", default="")
    p.add_argument("--base-only", action="store_true")
    p.add_argument("--sample", type=int, default=0)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--hots", default="/Applications/Heroes of the Storm")
    p.add_argument("--casc", default=os.environ.get("SC2_CASC_TOOL", os.path.expanduser("~/tools/stormex/build/bin/stormex")))
    p.add_argument("--viewer", default=os.path.expanduser("~/.cache/sc2-adjutant/whiteoutflakes/stage/WhiteoutFlakes.app/Contents/MacOS/WhiteoutFlakes"))
    p.add_argument("--workers", type=int, default=4)
    a = p.parse_args()

    listed = run([a.casc, "-S", a.hots, "-l", "-I", r"assets\\effects\\.*\.m3$"]).stdout.split("\n")
    models = [line.strip() for line in listed if line.strip().lower().endswith(".m3")]
    if a.base_only:
        models = [m for m in models if "_Base_" in m]
    if a.only:
        models = [m for m in models if re.search(a.only, m, re.I)]
    if a.sample:
        random.seed(a.seed)
        models = random.sample(models, min(a.sample, len(models)))
    print(f"{len(models)} models", file=sys.stderr)
    if not models:
        return

    def below_effects(path):
        """A model's path below Assets/Effects, lower-cased, with forward slashes."""
        slashed = path.replace("\\", "/")
        return slashed[slashed.lower().rindex("assets/effects/") + len("assets/effects/") :]

    # Each chosen model by its own path below Assets/Effects: exactly these, nested folders and all.
    chosen = {}
    for m in models:
        chosen.setdefault(below_effects(m).lower(), below_effects(m))
    with tempfile.TemporaryDirectory() as work:
        raw = os.path.join(work, "raw")
        os.makedirs(raw)
        keys = sorted(chosen)
        # One extraction per hundred models, so the regex stays a sensible length.
        for i in range(0, len(keys), 100):
            pattern = r"assets\\effects\\(" + "|".join(re.escape(k.replace("/", "\\")) for k in keys[i : i + 100]) + r")$"
            run([a.casc, "-S", a.hots, "-I", pattern, "-x", "-o", raw], timeout=600)
        sources = {}
        for root, _, files in os.walk(raw):
            for f in files:
                key = below_effects(os.path.join(root, f)).lower()
                if key in chosen:
                    sources.setdefault(chosen[key], os.path.join(root, f))
        missing = [chosen[k] for k in keys if chosen[k] not in sources]
        for name in missing:
            print(f"not extracted: {name}", file=sys.stderr)
        textures = set()
        for src in sources.values():
            with open(src, "rb") as fh:
                for m in DDS.finditer(fh.read()):
                    textures.add(re.split(r"[\\/]", m.group().decode())[-1])
        tex = os.path.join(work, "tex")
        os.makedirs(tex)

        def extracted():
            """The textures extracted so far, by lower-cased name: True if it has data, False if empty."""
            seen = {}
            for root, _, files in os.walk(tex):
                for f in files:
                    seen[f.lower()] = seen.get(f.lower(), False) or os.path.getsize(os.path.join(root, f)) > 0
            return seen

        # stormex writes 0 bytes for a texture this install lists but doesn't hold, then spins forever, so
        # each run has a timeout, and the textures not yet out are asked for again until a run gets no more.
        pending = sorted({t.lower() for t in textures})
        while pending:
            for i in range(0, len(pending), 200):
                pattern = r"\\(" + "|".join(re.escape(n) for n in pending[i : i + 200]) + r")$"
                run([a.casc, "-S", a.hots, "-I", pattern, "-x", "-o", tex], timeout=120)
            seen = extracted()
            still = [n for n in pending if n not in seen]
            if len(still) == len(pending):
                break
            pending = still
        out_tex = os.path.join(a.out, "Assets", "Textures")
        os.makedirs(out_tex, exist_ok=True)
        found = 0
        empty = set()
        for root, _, files in os.walk(tex):
            for f in files:
                if os.path.getsize(os.path.join(root, f)) == 0:
                    empty.add(f)
                    continue
                if not os.path.exists(os.path.join(out_tex, f)):
                    shutil.copyfile(os.path.join(root, f), os.path.join(out_tex, f))
                    found += 1

        def convert(item):
            name, src = item
            dest = os.path.join(a.out, "Assets", "Effects", "HotS", *name.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            # Each worker gets its own HOME: WhiteoutFlakes keeps caches there, and processes sharing them
            # corrupt them (docs/reference/related-repos.md). One conversion hung on 2026-11-23, hence the timeout.
            home = os.path.join(work, "homes", threading.current_thread().name)
            os.makedirs(home, exist_ok=True)
            r = run([a.viewer, src, "--save-m3", dest, "--save-m3-sc2"], timeout=120, env={**os.environ, "HOME": home})
            return name, os.path.exists(dest) and os.path.getsize(dest) > 0, r.stdout[-300:] + r.stderr[-300:]

        failed = []
        with concurrent.futures.ThreadPoolExecutor(a.workers) as pool:
            for name, ok, log in pool.map(convert, sorted(sources.items())):
                if not ok:
                    failed.append(name)
                    print(f"failed: {name}: {log.strip()}", file=sys.stderr)
    if empty:
        print(f"textures not in this install (extracted empty, left out): {', '.join(sorted(empty))}", file=sys.stderr)
    print(f"{len(sources) - len(failed)} of {len(chosen)} converted ({len(missing)} not extracted, {len(failed)} failed); {found} textures of {len(textures)} named", file=sys.stderr)


if __name__ == "__main__":
    main()
