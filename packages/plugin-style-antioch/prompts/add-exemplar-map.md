Add the map {{map}} to the Antioch Style Pack as Exemplar Map {{id}}. Provenance: {{provenance}} (ask the author when it's blank).

Follow the pack's `exemplar-maps-readme` knowledge document, one step at a time:

1. Ask the author for the provenance if it isn't given: `made` (they made it), `edited` (they edited it) or `approved` (a map they admire). Evidence from a `made` map weighs most.
2. Add `{ "id": "{{id}}", "map": "{{map}}", "provenance": ... }` to the pack's `exemplar-maps/exemplars.json`. The `map` path is inside the folder the machine config's `exemplarMaps` (or `SC2_ADJUTANT_EXEMPLAR_MAPS`) names; check the map is there.
3. Run `npm run study -- {{id}}` to write its Map Study and layer renders, then its captures as the README describes.
4. Measure it against every Design Lesson in the pack's `lessons` document. For each lesson it supports, contradicts or extends, bring it to the author one at a time, with its numbers and two to four frames (when the captures exist; otherwise its numbers and layer images), and wait for their answer before the next.
5. Edit `LESSONS.md` only with what the author ratified, with the date. Cite each frame by map, lighting and stop (or place centre), in words that stand without the picture, never by its file: the frames stay out of the pack. Copy them into the research archive's `docs/research/exemplar-maps/{{id}}/evidence/` (under `$SC2_RESEARCH_DIR`) for later reference.
