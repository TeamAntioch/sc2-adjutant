"""Find Blizzard music for a scene, and write a listening sheet the author can audition.

Search (prints candidate cards):
  python3 -I find_music.py search --words "tense alien dread" [--energy 2-3] [--tension 4-5]
      [--valence 1-2] [--min-seconds 30] [--max-seconds 200] [--kind "full cue,stinger"]
      [--faction terran|protoss|zerg|none] [--origin LotV] [--all-stacks] [--top 10]

Show one or more files or ids in full:
  python3 -I find_music.py show <file base name or id> ...

Listening sheet (HTML, opens in a browser):
  python3 -I find_music.py sheet <spec.json> <out.html> [--audio-root DIR]

  spec.json:
  {"title": "Scene 1: the approach", "brief": "what the scene needs, its length",
   "slots": [{"name": "Bed", "need": "tense build under the approach, ~60 s",
              "candidates": [{"pick": "Space_1_FULL", "why": "...", "from": "0:38"}]}]}

  `pick` is a file base name (`Space_1_FULL`) or a Soundtrack or Sound id. `from` is an
  optional suggested in-point.

The catalogue is tracks.json, beside this script. Descriptions there are [gemini] model listening unless
`description_basis` is "sourced". By default only music our maps load (`in_our_stack`)
is searched, and silent, empty and sound-effect files are dropped.

Audio for the sheet: --audio-root DIR, or $SC2_MUSIC_AUDIO, a folder of the game's music
extracted by install path (tools/README.md says how). Without it, the sheet still lists the
candidates and says how to extract the audio.
"""
import sys, os, re, json, html, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOGUE = os.path.join(HERE, 'tracks.json')


def load():
    with open(CATALOGUE) as f:
        d = json.load(f)
    pieces = {akey(p['asset']): p for p in d['pieces']}
    ids = {s['id']: s for s in d['soundtracks']}
    return pieces, ids


def akey(path):
    return path.lower().replace('\\', '/')


def base(path):
    return os.path.splitext(path.replace('\\', '/').rsplit('/', 1)[-1])[0]


def mmss(s):
    s = int(round(s or 0))
    return f'{s // 60}:{s % 60:02d}'


def seconds(t):
    if t is None:
        return None
    if isinstance(t, (int, float)):
        return float(t)
    m = re.match(r'^(\d+):(\d{1,2}(?:\.\d+)?)$', str(t).strip())
    return int(m.group(1)) * 60 + float(m.group(2)) if m else float(t)


def callable_ids(p, ids, stack_only):
    """Soundtrack ids that play exactly this file, and the Sound ids an in-point needs."""
    tracks, sounds = [], []
    for i in p['exact_ids']:
        s = ids.get(i)
        if not s or (stack_only and not s['in_our_stack']):
            continue
        if s['kind'] == 'Soundtrack':
            tracks.append(i)
            sounds += [x['id'] for x in s['sounds'] if x.get('layer', 'master') == 'master']
        else:
            sounds.append(i)
    return list(dict.fromkeys(tracks)), list(dict.fromkeys(sounds))


def usable(p, ids, stack_only):
    if p['silent'] or not p['in_install']:
        return False
    l = p.get('listened') or {}
    if l.get('kind') in ('sound effect', 'silence'):
        return False
    t, s = callable_ids(p, ids, stack_only)
    return bool(t or s)


def used_where(p, ids):
    return sorted({u['where'] + (f" ({u['context']})" if u.get('context') else '')
                   for i in p['exact_ids'] for u in (ids.get(i, {}).get('used_in') or [])})


def stem(w):
    return w.lower()[:5]


def text_fields(p):
    l = p.get('listened') or {}
    strong = ' '.join((p.get('mood') or []) + (l.get('mood') or []) + (p.get('use_for') or []) + (l.get('use_for') or []))
    weak = ' '.join(str(x) for x in [p.get('description'), l.get('summary'), l.get('arc'), l.get('style'),
                                     ' '.join(l.get('instrumentation') or []), l.get('faction_feel'), base(p['asset'])])
    return strong.lower(), weak.lower()


def score(p, words):
    strong, weak = text_fields(p)
    sw = set(stem(w) for w in re.findall(r'[a-z]+', strong))
    ww = set(stem(w) for w in re.findall(r'[a-z]+', weak))
    sc = 0.0
    for w in words:
        k = stem(w)
        sc += 3 if k in sw else 1 if k in ww else 0
    if p['description_basis'] == 'sourced':
        sc += 0.5
    return sc


def in_range(v, r):
    if not r:
        return True
    if v is None:
        return False
    lo, _, hi = r.partition('-')
    return float(lo) <= v <= float(hi or lo)


FACTION = {'terran': 'frontier', 'protoss': 'ancient', 'zerg': 'swarm', 'none': 'none'}


def card(p, ids, stack_only, n=None, full=False):
    l = p.get('listened') or {}
    t, s = callable_ids(p, ids, stack_only)
    head = f"{n}. " if n else ''
    out = [f"{head}{base(p['asset'])}  ({mmss(p['duration_s'])}, {l.get('kind', '?')}, ends: {l.get('ending', '?')})"]
    out.append(f"   energy {p.get('energy')} · tension {l.get('tension')} · valence {l.get('valence')} · "
               f"{l.get('tempo_bpm') or 'no'} BPM · {l.get('faction_feel', '')[:40]}")
    desc = p.get('description') or l.get('summary') or ''
    src = p.get('description_src') or '[gemini]'
    out.append(f"   {src} {desc}")
    if t:
        out.append(f"   Soundtrack (from the top): {', '.join(t[:3])}")
    if s:
        out.append(f"   Sound (for an in-point): {', '.join(s[:3])}")
    used = used_where(p, ids)
    if used:
        out.append(f"   Blizzard used it: {'; '.join(used[:3])}")
    secs = l.get('sections') or []
    if secs:
        show = secs if full else secs[:6]
        out.append('   Sections: ' + ' | '.join(f"{x['start']} {x['description'][:60 if not full else 200]}" for x in show))
    if p.get('check'):
        out.append(f"   CHECK: {'; '.join(p['check'])} (listen before trusting the description)")
    if full and l.get('avoid_for'):
        out.append(f"   Avoid for: {'; '.join(l['avoid_for'])}")
    return '\n'.join(out)


def resolve(pick, pieces, ids):
    k = pick.lower()
    for key, p in pieces.items():
        if base(p['asset']).lower() == k:
            return p
    s = ids.get(pick)
    if s and s['assets']:
        return pieces.get(akey(s['assets'][0]))
    raise SystemExit(f'not found: {pick} (give a file base name or a Soundtrack/Sound id)')


def cmd_search(a):
    pieces, ids = load()
    stack_only = not a.all_stacks
    words = re.findall(r'[a-z]+', (a.words or '').lower())
    kinds = [k.strip() for k in a.kind.split(',')] if a.kind else None
    rows = []
    for p in pieces.values():
        if not usable(p, ids, stack_only):
            continue
        l = p.get('listened') or {}
        if kinds and l.get('kind') not in kinds:
            continue
        if not (in_range(p.get('energy'), a.energy) and in_range(l.get('tension'), a.tension) and in_range(l.get('valence'), a.valence)):
            continue
        d = p['duration_s'] or 0
        if (a.min_seconds and d < a.min_seconds) or (a.max_seconds and d > a.max_seconds):
            continue
        if a.faction and FACTION[a.faction] not in (l.get('faction_feel') or '').lower():
            continue
        if a.origin and a.origin.lower() not in p['origin'].lower():
            continue
        rows.append((score(p, words) if words else 0, p))
    rows.sort(key=lambda r: (-r[0], base(r[1]['asset'])))
    print(f'{len(rows)} files match the filters; top {min(a.top, len(rows))} by word match:\n')
    for n, (sc, p) in enumerate(rows[:a.top], 1):
        print(card(p, ids, stack_only, n) + '\n')


def cmd_show(a):
    pieces, ids = load()
    for pick in a.picks:
        print(card(resolve(pick, pieces, ids), ids, not a.all_stacks, full=True) + '\n')


def audio_index(root):
    idx = {}
    if root and os.path.isdir(root):
        for dp, dn, fn in os.walk(root):
            for f in fn:
                p = os.path.join(dp, f)
                idx.setdefault(os.path.relpath(p, root).lower().split('.sc2assets/', 1)[-1], p)
    return idx


SHEET_CSS = """
body{font:15px/1.45 -apple-system,system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#1d1d1f;background:#fafafa}
h1{font-size:22px;margin:0 0 4px}.brief{color:#555;margin:0 0 20px}
h2{font-size:17px;margin:28px 0 4px;border-bottom:1px solid #ddd;padding-bottom:4px}.need{color:#555;margin:0 0 10px}
.c{background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:12px 14px;margin:10px 0}
.c h3{font-size:15px;margin:0 0 2px}.meta{color:#666;font-size:13px}.why{margin:6px 0;color:#333}
.desc{margin:6px 0}.src{color:#888;font-size:12px}audio{width:100%;margin:8px 0 4px}
.secs button,.tools button{font:13px system-ui;margin:2px 4px 2px 0;padding:3px 8px;border:1px solid #ccc;border-radius:5px;background:#f4f4f4;cursor:pointer}
.secs button:hover,.tools button:hover{background:#e8e8ff}.tools{margin-top:6px}.now{font:13px ui-monospace,monospace;margin-left:6px}
.ids{font:12px ui-monospace,monospace;color:#444;margin-top:4px}.check{color:#a33;font-size:13px}
.missing{color:#a33}#picks{position:sticky;bottom:0;background:#fff;border-top:2px solid #99c;padding:10px 0;margin-top:30px}
#picks textarea{width:100%;height:90px;font:13px ui-monospace,monospace}
"""

SHEET_JS = """
const fmt=s=>{s=Math.max(0,s);const m=Math.floor(s/60),r=(s-m*60).toFixed(1).padStart(4,'0');return m+':'+r};
const picks=[];
function render(){document.getElementById('out').value=picks.map(p=>`${p.slot}: ${p.file} from ${p.from}${p.note?' ('+p.note+')':''}`).join('\\n')}
document.querySelectorAll('.c').forEach(c=>{
  const a=c.querySelector('audio'); if(!a) return;
  const now=c.querySelector('.now'); let inpt=null;
  a.addEventListener('timeupdate',()=>now.textContent=fmt(a.currentTime)+(inpt!==null?'  in-point '+fmt(inpt):''));
  c.querySelectorAll('.secs button').forEach(b=>b.onclick=()=>{a.currentTime=+b.dataset.t;a.play()});
  c.querySelector('.setin').onclick=()=>{inpt=a.currentTime;now.textContent=fmt(a.currentTime)+'  in-point '+fmt(inpt)};
  c.querySelector('.fromin').onclick=()=>{a.currentTime=inpt??(+c.dataset.from||0);a.play()};
  c.querySelector('.pick').onclick=()=>{
    const i=picks.findIndex(p=>p.slot===c.dataset.slot); const p={slot:c.dataset.slot,file:c.dataset.file,
      from:fmt(inpt??(+c.dataset.from||0)),note:''}; if(i>=0) picks[i]=p; else picks.push(p); render()};
  if(+c.dataset.from) a.addEventListener('loadedmetadata',()=>{a.currentTime=+c.dataset.from},{once:true});
});
document.querySelectorAll('audio').forEach(a=>a.addEventListener('play',()=>document.querySelectorAll('audio').forEach(b=>{if(b!==a)b.pause()})));
const probe=document.createElement('audio');
if(!probe.canPlayType('audio/ogg; codecs="vorbis"')) document.getElementById('warn').textContent=
  'This browser cannot play Ogg Vorbis. Open the sheet in Chrome or Firefox.';
document.getElementById('copy').onclick=()=>{navigator.clipboard.writeText(document.getElementById('out').value)};
"""


def cmd_sheet(a):
    pieces, ids = load()
    spec = json.load(open(a.spec))
    root = a.audio_root or os.environ.get('SC2_MUSIC_AUDIO', '')
    idx = audio_index(root)
    e = html.escape
    out = [f"<!doctype html><meta charset=utf-8><title>{e(spec.get('title', 'Listening sheet'))}</title><style>{SHEET_CSS}</style>",
           f"<h1>{e(spec.get('title', 'Listening sheet'))}</h1><p class=brief>{e(spec.get('brief', ''))}</p><p id=warn class=missing></p>"]
    if not idx:
        out.append(f"<p class=missing>No audio found at {e(root or '(no folder given)')}. Pass --audio-root or set SC2_MUSIC_AUDIO "
                   "to the game's music, extracted from the install as sc2-adjutant's tools/README.md says.</p>")
    missing = 0
    for slot in spec['slots']:
        out.append(f"<h2>{e(slot['name'])}</h2><p class=need>{e(slot.get('need', ''))}</p>")
        for n, c in enumerate(slot['candidates'], 1):
            p = resolve(c['pick'], pieces, ids)
            l = p.get('listened') or {}
            t, s = callable_ids(p, ids, False)
            f = idx.get(akey(p['asset']))
            frm = seconds(c.get('from')) or 0
            out.append(f"<div class=c data-slot='{e(slot['name'])}' data-file='{e(base(p['asset']))}' data-from='{frm}'>")
            out.append(f"<h3>{n}. {e(base(p['asset']))}</h3><div class=meta>{mmss(p['duration_s'])} · {e(str(l.get('kind', '')))} · "
                       f"ends: {e(str(l.get('ending', '')))} · energy {p.get('energy')} · tension {l.get('tension')} · "
                       f"valence {l.get('valence')} · {e(p['origin'])}</div>")
            if c.get('why'):
                out.append(f"<div class=why><b>Why:</b> {e(c['why'])}</div>")
            desc = p.get('description') or l.get('summary') or ''
            out.append(f"<div class=desc>{e(desc)} <span class=src>{e(p.get('description_src') or '[gemini]')}</span></div>")
            if f:
                out.append(f"<audio controls preload=metadata src='file://{e(f)}'></audio>")
            else:
                missing += 1
                out.append("<div class=missing>Audio file not found locally.</div>")
            secs = l.get('sections') or []
            if secs:
                out.append('<div class=secs>' + ''.join(
                    f"<button data-t='{seconds(x['start']) or 0}' title='{e(x['description'])}'>{e(x['start'])} {e(x['description'][:42])}</button>"
                    for x in secs) + '</div>')
            out.append("<div class=tools><button class=setin>Set in-point here</button><button class=fromin>Play from in-point</button>"
                       "<button class=pick>Pick this for the slot</button><span class=now></span></div>")
            if frm:
                out.append(f"<div class=meta>Suggested in-point: {mmss(frm)}</div>")
            used = used_where(p, ids)
            if used:
                out.append(f"<div class=meta>Blizzard used it: {e('; '.join(used[:3]))}</div>")
            out.append(f"<div class=ids>Soundtrack: {e(', '.join(t[:2]) or '-')} · Sound (in-point): {e(', '.join(s[:2]) or '-')}</div>")
            if p.get('check'):
                out.append(f"<div class=check>Models disagree: {e('; '.join(p['check']))}</div>")
            out.append('</div>')
    out.append("<div id=picks><b>Your picks</b> (copy these back to the agent) <button id=copy>Copy</button>"
               "<textarea id=out placeholder='Pick a candidate per slot; set an in-point first if it should not start at the top.'></textarea></div>")
    out.append(f"<script>{SHEET_JS}</script>")
    with open(a.out, 'w') as fh:
        fh.write('\n'.join(out))
    print(f'wrote {a.out}: {sum(len(s["candidates"]) for s in spec["slots"])} candidates in {len(spec["slots"])} slots'
          + (f', {missing} without local audio' if missing else ''))


ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
sub = ap.add_subparsers(dest='cmd', required=True)
s = sub.add_parser('search')
s.add_argument('--words')
s.add_argument('--energy')
s.add_argument('--tension')
s.add_argument('--valence')
s.add_argument('--min-seconds', type=float)
s.add_argument('--max-seconds', type=float)
s.add_argument('--kind')
s.add_argument('--faction', choices=list(FACTION))
s.add_argument('--origin')
s.add_argument('--all-stacks', action='store_true')
s.add_argument('--top', type=int, default=10)
s.set_defaults(fn=cmd_search)
s = sub.add_parser('show')
s.add_argument('picks', nargs='+')
s.add_argument('--all-stacks', action='store_true')
s.set_defaults(fn=cmd_show)
s = sub.add_parser('sheet')
s.add_argument('spec')
s.add_argument('out')
s.add_argument('--audio-root')
s.set_defaults(fn=cmd_sheet)
a = ap.parse_args()
a.fn(a)
