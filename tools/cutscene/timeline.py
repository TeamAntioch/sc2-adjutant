"""Shot-by-shot timeline of one .SC2Cutscene: camera cuts (name, lens, distance, pitch), lines
(speaker, text, estimated length), fades, Active Light switches, bookmark jumps and End Scene markers.
usage: python3 -I timeline.py FILE.SC2Cutscene [DOCDIR]
DOCDIR is the map or mod folder holding enUS.SC2Data/LocalizedData/ConversationStrings.txt and
Base.SC2Data/GameData/ConversationData.xml; without it, lines show only their ids."""
import os
import re
import sys
import xml.etree.ElementTree as ET

FILE = sys.argv[1]
DOC = sys.argv[2] if len(sys.argv) > 2 else None

strings, speaker = {}, {}
if DOC:
    sp = os.path.join(DOC, "enUS.SC2Data/LocalizedData/ConversationStrings.txt")
    if os.path.exists(sp):
        for ln in open(sp, encoding="utf-8-sig"):
            k, _, v = ln.rstrip("\n").partition("=")
            strings[k.split("/")[-1]] = v
    cp = os.path.join(DOC, "Base.SC2Data/GameData/ConversationData.xml")
    if os.path.exists(cp):
        conv = open(cp, encoding="utf-8").read()
        speaker = {m.group(1): m.group(2) for m in re.finditer(
            r'<Id value="(Line\d+)"/>.*?<SpeakerCharacter value="Char([^"]*)"', conv, re.S)}

root = ET.parse(FILE).getroot()
names = {el.get("guid"): el.get("name") for el in root.iter() if el.get("guid") and el.get("name")}
cams = {el.get("guid"): el for el in root.iter() if el.tag in ("CCutsceneNodeCamera", "CCutsceneNodeTargetCamera")}


def num(el, attr):
    try:
        return float(el.get(attr))
    except (TypeError, ValueError):
        return None


events = []
for el in root.iter():
    t = float(el.get("start", 0)) / 1000
    if el.tag == "CCutsceneElementActiveCamera":
        c = cams.get(el.get("objectGuid"))
        desc = names.get(el.get("objectGuid"), el.get("objectGuid"))
        if c is not None:
            vals = [(k, num(c, k)) for k in ("fov", "distance", "pitch")]
            desc += "  (" + " ".join(f"{k} {v:.1f}" for k, v in vals if v is not None) + ")"
        events.append((t, "CUT", desc))
    elif el.tag in ("CCutsceneElementConversationDriver", "CCutsceneElementConversation") and el.get("lineId"):
        lid = el.get("lineId")
        text = strings.get(lid, "")
        est = f"  [~{0.91 + 0.39 * len(text.split()):.1f}s]" if text else ""
        events.append((t, "LINE", f"{speaker.get(lid, '?')}: {text or lid}{est}"))
    elif el.tag == "CCutsceneElementFade":
        kind = "in" if el.get("fadeIn") == "1" else "out"
        events.append((t, "FADE", f"{kind} {float(el.get('duration', 0)) / 1000:.1f}s"))
    elif el.tag == "CCutsceneElementActiveLight":
        events.append((t, "LIGHT", f"{el.get('lightID')} blend {el.get('blendTime', '0')}"))
    elif el.tag == "CCutsceneElementEndScene":
        events.append((t, "END", "End Scene"))
    elif el.tag == "CCutsceneElementBookmark" and el.get("jumpToBookmarkWhenHit"):
        events.append((t, "JUMP", f"to bookmark {el.get('jumpToBookmarkWhenHit')}"))

for t, kind, desc in sorted(events, key=lambda e: (e[0], e[1] != "CUT")):
    print(f"{t:7.2f}  {kind:5} {desc}")
if not any(k == "END" for _, k, _ in events):
    print("   (no End Scene marker)")
marks = {el.get("bookmarkName") for el in root.iter("CCutsceneElementBookmark") if el.get("bookmarkName")}
for el in root.iter("CCutsceneElementBookmark"):
    target = el.get("jumpToBookmarkWhenHit")
    if target and target not in marks:
        print(f"   (jump at {float(el.get('start', 0)) / 1000:.2f}s targets bookmark '{target}', which this file doesn't define)")
