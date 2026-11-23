"""Write core's list of the Music Sounds our maps load (packages/core/data/music-sounds.json).

  python3 -I music_sounds.py

A trigger scene's music cue plays a Music-category CSound with an offset (SoundPlayForPlayer), so
the id it names must be a CSound our maps' dependency stack loads, and one that plays real audio
(CHECKS.md M1). Those are the catalogue's `Sound` ids in our stack, and the CSounds that our
stack's Soundtracks play, each defined in a mod or campaign of the stack. Silent and empty ids
(`silent`, `empty` in tracks.json) are left out. Each id maps to its file's length in seconds, the
longest when it can play several (a Soundtrack's sounds take the Soundtrack's), or null when unmeasured.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOGUE = os.path.join(HERE, 'tracks.json')
OUT = os.path.join(HERE, '..', '..', 'packages', 'core', 'data', 'music-sounds.json')


def root(defined):
    """The mod or campaign folder a definition sits in: mods/void.sc2mod, campaigns/void.sc2campaign."""
    parts = defined.split('/')
    for at, part in enumerate(parts):
        if part.endswith(('.sc2mod', '.sc2campaign')):
            return '/'.join(parts[:at + 1])
    return None


def main():
    with open(CATALOGUE) as f:
        ids = json.load(f)['soundtracks']
    playable = [entry for entry in ids if entry['in_our_stack'] and not entry['silent'] and not entry['empty']]
    stack = {root(defined) for entry in playable for defined in entry['defined']} - {None}
    def longest(entry):
        span = entry.get('duration_range_s')
        return span[1] if span else entry.get('duration_s')

    sounds = {entry['id']: longest(entry) for entry in playable if entry['kind'] == 'Sound'}
    for entry in playable:
        if entry['kind'] != 'Soundtrack':
            continue
        for sound in entry['sounds']:
            if sound.get('defined') and all(root(defined) in stack for defined in sound['defined']):
                known = sounds.get(sound['id'])
                length = longest(entry)
                sounds[sound['id']] = length if known is None else (known if length is None else max(known, length))
    out = {
        'about': 'Music-category CSound ids our maps load that play real audio, each with its file\'s length in seconds (the longest it can play; null unmeasured), for a trigger scene\'s music cues (CHECKS.md M1, M4). Generated from tools/music/tracks.json by tools/music/music_sounds.py.',
        'sounds': {id: sounds[id] for id in sorted(sounds)},
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print(f'{len(sounds)} Music Sounds -> {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
