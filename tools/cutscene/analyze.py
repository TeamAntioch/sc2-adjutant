"""Parse every .SC2Cutscene under ROOT and write one JSON record per file.
usage: python3 -I analyze.py ROOT OUT.json
"""
import sys, os, re, json, math, bisect
import xml.etree.ElementTree as ET

ROOT, OUT = sys.argv[1], sys.argv[2]


def campaign_of(rel):
    if '/swarmstory.' in rel: return 'HotS-story'
    if '/swarm.sc2campaign' in rel: return 'HotS-swarm'
    if '/voidstory.' in rel: return 'LotV-story'
    if 'novastoryassets' in rel: return 'NCO'
    if 'voidprologue' in rel: return 'LotV-prologue'
    if 'starcoop' in rel: return 'Coop'
    if 'liberty.sc2mod' in rel or 'core.sc2mod' in rel: return 'Menus'
    return 'other'


def kind_of(name, camp):
    n = name
    if camp in ('Menus', 'Coop'): return 'menu-ui'
    if re.match(r'(UI_|UIView_|Z_UI_|Backgrounds_|Ambient_|Dev_Lighting_|StorymodeSet_|MainMenu|PlanetView|DebugScene|Z_CharCameras|Nova06Flashback)', n):
        return 'backdrop-ui'
    if re.match(r'(Conversations_|Convo_)', n): return 'conversation'
    if camp == 'HotS-swarm': return 'story-cinematic'  # Zerg01-10, camera baked in .m3
    if re.match(r'(Cutscene_Mission|Cutscene_Tutorial|Mission_|MissionAmb_|ZChar02|ZExpedition03Victory|ZSpace02Elevator|zSpace02_Intro|Untitled Scene|MonsterBirth|Nova04VoidRay|SMX3_Cutscene_Nova04|zLD_|ZMissionSpace01Victory|Cutscene_Purifier02Intro|Cutscene_ProtossStinger)', n):
        return 'in-mission'
    if re.match(r'(Cutscene_|zSMBriefing_|ZSMBriefing_|ZBriefingSpace|zSM_|zScripted_|zDebrief_|SMX3_Cutscene_MP|Prologue)', n):
        return 'story-cinematic'
    return 'other'


def f(x, d=None):
    try: return float(x)
    except (TypeError, ValueError): return d


def st(el):
    return f(el.get('start'), 0.0)


class Prop:
    """A static value plus optional animation keys (time, value)."""
    def __init__(self, static, keys):
        self.static, self.keys = static, sorted(keys)
    def at(self, t):
        k = self.keys
        if not k: return self.static
        if t <= k[0][0]: return k[0][1]
        if t >= k[-1][0]: return k[-1][1]
        i = bisect.bisect_right([a for a, _ in k], t)
        (t0, v0), (t1, v1) = k[i - 1], k[i]
        return v0 if t1 == t0 else v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    def nkeys(self, a, b):
        return sum(1 for t, _ in self.keys if a < t < b)


def props(node):
    out = {}
    for pv in node.findall('CCutsceneNodePropertyValue'):
        if pv.get('enabled') == '0': continue
        keys = []
        for c in pv:
            v = f(c.get('value'))
            if v is None: continue
            t = f(c.get('time'), st(c))
            keys.append((t, v))
        out[pv.get('propertyName')] = keys
    return out


def vec(s, n=3):
    try:
        p = [float(x) for x in s.split(',')][:n]
        return p if len(p) == n else None
    except Exception:
        return None


def camera_model(node):
    """Return a callable t -> dict for a camera node."""
    pk = props(node)
    tag = node.tag
    def P(name, default):
        return Prop(f(node.get(name), default), pk.get(name, []))
    common = {k: P(k, d) for k, d in [('fov', 27.8), ('focalDepth', None), ('fstop', None), ('depthOfField', 0.0),
                                       ('doftype', None), ('roll', 0.0), ('falloffStart', None), ('falloffEnd', None)]}
    if tag == 'CCutsceneNodeTargetCamera':
        ex, ey, ez = P('eyePositionX', 0), P('eyePositionY', 0), P('eyePositionZ', 0)
        tx, ty, tz = P('targetPositionX', 0), P('targetPositionY', 0), P('targetPositionZ', 0)
        def at(t):
            e = (ex.at(t), ey.at(t), ez.at(t)); g = (tx.at(t), ty.at(t), tz.at(t))
            d = math.dist(e, g) if None not in e + g else None
            pitch = math.degrees(math.asin(max(-1, min(1, (e[2] - g[2]) / d)))) if d else None
            r = {k: v.at(t) for k, v in common.items()}
            r.update(eye=e, target=g, distance=d, pitch=pitch)
            return r
        animated = [ex, ey, ez, tx, ty, tz]
    else:  # CCutsceneNodeCamera: target position + distance/pitch/yaw
        pos = vec(node.get('position', '0,0,0')) or [0, 0, 0]
        px, py, pz = P('positionX', pos[0]), P('positionY', pos[1]), P('positionZ', pos[2])
        dist, pit, yaw, ho = P('distance', None), P('pitch', None), P('yaw', None), P('heightOffset', 0)
        def at(t):
            d, p, y = dist.at(t), pit.at(t), yaw.at(t)
            g = (px.at(t), py.at(t), pz.at(t) + (ho.at(t) or 0))
            e = None
            if None not in (d, p, y):
                # editor pitch is stored 0-360; >180 means looking up
                pp = p - 360 if p > 180 else p
                e = (g[0] - d * math.cos(math.radians(pp)) * math.sin(math.radians(y)),
                     g[1] - d * math.cos(math.radians(pp)) * math.cos(math.radians(y)),
                     g[2] + d * math.sin(math.radians(pp)))
            r = {k: v.at(t) for k, v in common.items()}
            r.update(eye=e, target=g, distance=d, pitch=(p - 360 if p is not None and p > 180 else p))
            return r
        animated = [px, py, pz, dist, pit, yaw]
    return at, animated, common['fov']


def light_role(name):
    n = name.lower()
    if re.search(r'rim|back|edge|kick|halo', n): return 'rim/back'
    if re.search(r'key|main|fronkey', n): return 'key'
    if re.search(r'fill|bounce|ambient|ambi', n): return 'fill'
    if re.fullmatch(r'(spot|omni) light[\s\d]*', n): return 'unnamed'
    return 'other'


def analyse(path, rel):
    root = ET.parse(path).getroot()
    name = os.path.basename(path)[:-12]
    camp = campaign_of(rel)
    rec = dict(path=rel, name=name, campaign=camp, kind=kind_of(name, camp), version=root.get('cutsceneVersion'),
               size=os.path.getsize(path))
    # references
    rec['referenceFiles'] = sorted({e.get('referenceFile') for e in root.iter() if e.get('referenceFile')})
    directors = list(root.iter('CCutsceneNodeDirector'))
    rec['directors'] = len(directors)

    def enabled(e): return e.get('enabled') != '0'
    # bookmarks, ends
    bms = [(st(e), e.get('bookmarkName'), e.get('jumpToBookmarkWhenHit'), e.get('pauseWhenHit') == '1', tr.get('name'))
           for tr in root.iter('CCutsceneNodeBookmark') if enabled(tr) for e in tr if enabled(e)]
    bmtime = {}
    for t, n, j, p, tn in bms:
        bmtime.setdefault(n, t)
    ends = sorted(st(e) for tr in root.iter('CCutsceneNodeEndScene') if enabled(tr) for e in tr if enabled(e))
    rec['bookmarks'] = len(bms); rec['jumps'] = sum(1 for b in bms if b[2]); rec['pauses'] = sum(1 for b in bms if b[3])
    rec['endScenes'] = ends
    # active camera (index 0)
    acs = sorted((st(e), e.get('objectGuid')) for tr in root.iter('CCutsceneNodeActiveCamera') if enabled(tr)
                 for e in tr if enabled(e) and e.get('cameraIndex', '0') == '0')
    rec['activeCameraEntries'] = len(acs)
    # camera nodes
    camnodes = {}
    for tag in ('CCutsceneNodeTargetCamera', 'CCutsceneNodeCamera'):
        for n in root.iter(tag):
            camnodes[n.get('guid')] = n
    rec['cameraNodes'] = {'target': len(list(root.iter('CCutsceneNodeTargetCamera'))), 'classic': len(list(root.iter('CCutsceneNodeCamera')))}
    actor_by_guid = {a.get('guid'): a for a in root.iter('CCutsceneNodeActor')}
    model_cam = False
    if acs and all(g not in camnodes for _, g in acs):
        a = actor_by_guid.get(acs[0][1])
        model_cam = a is not None
        rec['modelCamera'] = (a.get('modelPath') or a.get('modelLink')) if a is not None else None
    # dialogue line starts (timeline ms)
    lines = sorted({st(e) for e in root.iter('CCutsceneElementConversation') if enabled(e)} |
                   {st(e) for e in root.iter('CCutsceneElementConversationDriver') if enabled(e)})
    rec['lines'] = len(lines)

    # ---- playback with jumps -> played pieces [(t0, t1)]
    content = [t for t, _ in acs] + [b[0] for b in bms] + lines
    for e in root.iter('CCutsceneElementConversation'):
        content.append(st(e) + f(e.get('duration'), 0))
    tl_end = max(content) if content else 0.0
    stops = sorted(set(ends)) or [tl_end]
    segments = []
    seg_start = 0.0
    for E in stops:
        if E <= seg_start: continue
        pieces, cur, guard, looped = [], seg_start, 0, False
        while guard < 200:
            guard += 1
            nxt = [(t, j) for t, n, j, p, tn in bms if j and cur < t < E]
            if not nxt:
                pieces.append((cur, E)); break
            t, j = min(nxt)
            pieces.append((cur, t))
            x = bmtime.get(j)
            if x is None or x <= t:
                looped = x is not None; break
            if x >= E:
                # jumped past this segment's end marker: find the next end marker
                later = [e for e in stops if e > x]
                if not later: break
                E = later[0]
            cur = x
        segments.append(dict(pieces=pieces, looped=looped))
        # next take starts at the first camera/bookmark entry at or after E
        after = [t for t in [a for a, _ in acs] + [b[0] for b in bms] if t >= E]
        seg_start = min(after) if after else E
    rec['segments'] = []

    # cut points in timeline
    if model_cam:
        shotbm = sorted({b[0] for b in bms if 'shot' in (b[4] or '').lower() or re.search(r'_\d{3}[a-z]?$', b[1] or '')})
        cutsrc = [(t, 'bm%d' % i) for i, t in enumerate(shotbm)]
        rec['cutSource'] = 'shot-bookmarks' if shotbm else 'none'
    else:
        cutsrc = acs
        rec['cutSource'] = 'active-camera'
    cut_times = [t for t, _ in cutsrc]

    def cam_at(t):
        i = bisect.bisect_right(cut_times, t) - 1
        return cutsrc[i][1] if i >= 0 else None

    cammodels = {}
    for seg in segments:
        shots = []  # (tl_start, tl_end, played_start, played_dur, cam, cut_reason)
        played = 0.0
        for (a, b) in seg['pieces']:
            bounds = [a] + [t for t in cut_times if a < t < b] + [b]
            for x, y in zip(bounds, bounds[1:]):
                if y - x <= 0: continue
                cam = cam_at(x)
                if shots and shots[-1]['cam'] == cam and shots[-1]['tl1'] == x:
                    shots[-1]['tl1'] = y; shots[-1]['dur'] += y - x
                else:
                    shots.append(dict(tl0=x, tl1=y, p0=played, dur=y - x, cam=cam))
                played += y - x
        # mapped line starts in played time
        plines = []
        acc = 0.0
        for (a, b) in seg['pieces']:
            plines += [acc + (t - a) for t in lines if a <= t < b]
            acc += b - a
        seg_out = dict(played=played, pieces=len(seg['pieces']), looped=seg['looped'], shots=[])
        for i, s in enumerate(shots):
            o = dict(dur=s['dur'], cam=s['cam'], p0=s['p0'])
            if i > 0 and plines:
                offs = [s['p0'] - lt for lt in plines]
                o['lineOffset'] = min(offs, key=abs)
            node = camnodes.get(s['cam'])
            if node is not None:
                if s['cam'] not in cammodels:
                    cammodels[s['cam']] = camera_model(node)
                at, animated, fovp = cammodels[s['cam']]
                a0 = at(s['tl0']); a1 = at(max(s['tl0'], s['tl1'] - 1))
                o.update(type=node.tag[15:], fov=a0['fov'], distance=a0['distance'], pitch=a0['pitch'], roll=a0['roll'],
                         dof=a0['depthOfField'], focalDepth=a0['focalDepth'], fstop=a0['fstop'], doftype=a0['doftype'],
                         fovEnd=a1['fov'])
                move = None
                if a0['eye'] and a1['eye'] and a0['distance']:
                    move = (math.dist(a0['eye'], a1['eye']) + math.dist(a0['target'], a1['target'])) / a0['distance']
                o['move'] = move
                nk = max(p.nkeys(s['tl0'], s['tl1']) for p in animated)
                o['keysPerSec'] = nk / (s['dur'] / 1000) if s['dur'] > 0 else 0
            seg_out['shots'].append(o)
        rec['segments'].append(seg_out)

    # ---- lights
    lights = []
    for L in root.iter('CCutsceneNodeLight'):
        if not enabled(L): continue
        shots_ = [a.get('cameraGUID') for a in L.findall('CCutsceneNodeActiveShot') if enabled(a)]
        lights.append(dict(name=L.get('name', ''), role=light_role(L.get('name', '')), type=L.get('type'),
                           r=f(L.get('colorR'), 1.0), g=f(L.get('colorG'), 1.0), b=f(L.get('colorB'), 1.0),
                           mult=f(L.get('colorMultiplier'), 1.0), range=f(L.get('range')), shadow=L.get('shadowCasting') != '0',
                           specular=L.get('specular') != '0', activeShots=shots_, animated=len(L.findall('CCutsceneNodePropertyValue'))))
    rec['lights'] = lights
    al = sorted((st(e), e.get('lightID'), f(e.get('blendTime'), 0.0)) for tr in root.iter('CCutsceneNodeActiveLight') if enabled(tr) for e in tr if enabled(e))
    rec['activeLights'] = al
    rec['activeLightTracks'] = len([1 for tr in root.iter('CCutsceneNodeActiveLight') if enabled(tr)])
    rec['activeLightOnCut'] = sum(1 for t, _, _ in al if any(abs(t - c) <= 1 for c in cut_times))
    rec['envLights'] = len(list(root.iter('CCutsceneNodeEnvironmentLight')))
    rec['fogNodes'] = len(list(root.iter('CCutsceneNodeFog')))
    # fades
    rec['fades'] = [(st(e), f(e.get('duration'), 0.0), e.get('fadeIn') == '1') for e in root.iter('CCutsceneElementFade') if enabled(e)]
    # actors etc
    actors = [a for a in root.iter('CCutsceneNodeActor') if enabled(a)]
    rec['actors'] = len(actors)
    rec['actorsActiveShot'] = sum(1 for a in actors if a.findall('CCutsceneNodeActiveShot'))
    rec['speakerActors'] = sum(1 for a in actors if a.get('speakerTag'))
    rec['anims'] = len(list(root.iter('CCutsceneElementAnim')))
    rec['lookAts'] = len(list(root.iter('CCutsceneElementLookAt')))
    rec['m3a'] = len(list(root.iter('CCutsceneNodeM3A')))
    rec['paths'] = len(list(root.iter('CCutsceneNodePath')))
    rec['sounds'] = len(list(root.iter('CCutsceneNodeSound')))
    rec['convElements'] = len(list(root.iter('CCutsceneElementConversation')))
    rec['convDrivers'] = [d.get('conversationLink') for d in root.iter('CCutsceneNodeConversationDriver')]
    rec['rtt'] = len(list(root.iter('CCutsceneNodeRTTChannel')))
    rec['interactive'] = any(d.get('interactive') == '1' for d in directors)
    rec['shakeNamed'] = sum(1 for e in root.iter() if re.search(r'shake|handheld|noise|jitter', (e.get('name') or ''), re.I))
    rec['camNames'] = [n.get('name') for n in camnodes.values()][:200]
    return rec


recs = []
for dp, dn, fn in os.walk(ROOT):
    for fname in sorted(fn):
        if fname.lower().endswith('.sc2cutscene'):
            p = os.path.join(dp, fname)
            recs.append(analyse(p, os.path.relpath(p, ROOT)))
json.dump(recs, open(OUT, 'w'))
print(len(recs), 'records')
