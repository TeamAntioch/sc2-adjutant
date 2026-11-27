// The Still Review page (#124): one round's frames, for the author to judge, published as a Claude
// artifact with the db and user capabilities, beside its frames/ folder (frames are referenced as
// frames/<file>). The round's data is carried in the page as JSON (#review-data); the author's
// choices are kept in the artifact's db, one document per thing they set:
//
//   shots/<n>       { best, tags, note }   best: a version's label, or "no-change"
//   review/overall  { note }
//   review/status   { done }
//
// (A db document path has an even number of segments, so the round-wide documents sit under review/.)
// Each is written on change, debounced, one write at a time. Where the view has no db, or the
// viewer can't write, the page is read-only. The page script follows the artifact runtime's
// contract: capabilities come only from `await claude.use(name)`, which may resolve null, and
// anything the author typed is set with textContent or a control's value, never as HTML.

import type { StillPageData } from "./still-review.js";

/** The page, with its data. */
export function stillReviewPage(data: StillPageData): string {
  const title = `Stills ${data.set} ${data.round}`;
  // Safe inside a <script>: no "<", so no "</script>". The script holds JSON, which JSON.parse reads.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="claude:viewport-fit-sides" content="cover">`,
    `<style>${STYLE}</style>`,
    `<div id="app">`,
    `<header class="top"><div class="wrap"><p class="eyebrow" id="eyebrow"></p><h1 id="heading"></h1><dl class="facts" id="facts"></dl><ol class="versions" id="versions"></ol></div></header>`,
    `<div class="bar" id="bar"><div class="wrap bar-row">`,
    `<div class="seg" role="group" aria-label="Layout"><button type="button" id="mode-side" aria-pressed="true">Side by side</button><button type="button" id="mode-flip" aria-pressed="false">Flip</button></div>`,
    `<div class="seg" role="group" aria-label="Version shown" id="flip-picks" hidden></div>`,
    `<label class="check"><input type="checkbox" id="lift"> Lift shadows</label>`,
    `<span class="hint">Keys 1–9 flip to a version</span>`,
    `<span class="save" id="save-state" role="status" aria-live="polite"></span>`,
    `</div></div>`,
    `<main class="wrap"><section class="summary" id="summary"></section><div id="shots"></div>`,
    `<section class="overall"><h2>Overall</h2><p class="prev" id="prev-overall" hidden></p><label class="field" for="overall-note">Note on the whole round</label><textarea id="overall-note" rows="4"></textarea>`,
    `<div class="done-row"><button type="button" class="primary" id="done">Done reviewing</button><span id="done-state"></span></div></section></main>`,
    `</div>`,
    `<div class="lightbox" id="lightbox" hidden><button type="button" class="close" id="lightbox-close">Close</button><img id="lightbox-img" alt=""><p id="lightbox-caption"></p></div>`,
    `<script type="application/json" id="review-data">${json}</script>`,
    `<script>${SCRIPT}</script>`,
  ].join("\n");
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STYLE = `
/* Layout: one column of Shots, each a row of its versions' frames; a sticky bar of view controls. */
:root {
  --bg: #f6f7f8; --surface: #ffffff; --fg: #1b1f24; --muted: #5b6470; --line: #d9dde2;
  --accent: #2459c9; --accent-fg: #ffffff; --warn: #9a5b00; --warn-bg: #fff2dc; --gap: #eceef1;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --mono: ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111418; --surface: #1a1e24; --fg: #e6e9ed; --muted: #9aa3ae; --line: #2e343c;
  --accent: #7ea6ff; --accent-fg: #0d1117; --warn: #f0b45a; --warn-bg: #3a2a10; --gap: #20252c; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #111418; --surface: #1a1e24; --fg: #e6e9ed; --muted: #9aa3ae; --line: #2e343c;
  --accent: #7ea6ff; --accent-fg: #0d1117; --warn: #f0b45a; --warn-bg: #3a2a10; --gap: #20252c; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 var(--font); }
/* The artifact's skeleton hides [hidden] too; this keeps the lightbox shut when index.html is opened from disk. */
[hidden] { display: none !important; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--surface); }
.wrap { max-width: 1400px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
h1, h2, h3 { text-wrap: balance; margin: 0; line-height: 1.25; }
h1 { font-size: 1.6rem; } h2 { font-size: 1.2rem; } h3 { font-size: 1.05rem; }
.top { background: var(--surface); border-bottom: 1px solid var(--line); }
.top .wrap { padding-block: 20px; display: grid; gap: 10px; }
.eyebrow { margin: 0; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.facts { display: flex; flex-wrap: wrap; gap: 4px 24px; margin: 0; }
.facts div { display: flex; gap: 6px; } .facts dt { color: var(--muted); } .facts dd { margin: 0; }
.versions { margin: 0; padding-left: 1.4em; display: grid; gap: 2px; }
.versions b { font-family: var(--mono); font-weight: 600; }
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--surface); border-bottom: 1px solid var(--line); }
.bar-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding-block: 8px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { border: 0; background: transparent; color: var(--fg); padding: 6px 12px; font: inherit; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--line); }
.seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }
.check { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
.hint { color: var(--muted); font-size: 0.85rem; }
.save { margin-left: auto; color: var(--muted); font-size: 0.85rem; }
button:focus-visible, textarea:focus-visible, input:focus-visible, img:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
main { display: grid; gap: 24px; padding-block: 24px 48px; }
.summary { display: grid; gap: 6px; }
.summary p { margin: 0; }
.summary ul { margin: 0; padding-left: 1.2em; }
.notice { background: var(--warn-bg); color: var(--warn); border-radius: 6px; padding: 8px 12px; }
.shot { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: grid; gap: 12px; }
.shot-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.shot-head .num { font-family: var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.frames { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); }
.frames.flip { grid-template-columns: 1fr; }
figure { margin: 0; display: grid; gap: 4px; min-width: 0; }
figcaption { display: flex; gap: 8px; align-items: center; font-size: 0.85rem; color: var(--muted); }
figcaption b { color: var(--fg); font-family: var(--mono); font-weight: 600; }
.frame { width: 100%; aspect-ratio: 16 / 9; max-width: 100%; object-fit: cover; border-radius: 4px; background: var(--gap); cursor: zoom-in; display: block; }
.lifted .frame, .lifted #lightbox-img { filter: brightness(1.45) contrast(0.88); }
.gap { aspect-ratio: 16 / 9; max-width: 100%; border-radius: 4px; background: var(--gap); border: 1px dashed var(--line); display: grid; place-items: center; text-align: center; padding: 12px; color: var(--muted); font-size: 0.9rem; }
.badge { background: var(--warn-bg); color: var(--warn); border-radius: 999px; padding: 0 8px; font-size: 0.75rem; }
.pick { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; border: 0; margin: 0; padding: 0; }
.pick legend, .field { font-size: 0.85rem; color: var(--muted); padding: 0; }
.pick label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 999px; padding: 2px 10px; font: inherit; font-size: 0.85rem; cursor: pointer; }
.tag[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
textarea { width: 100%; box-sizing: border-box; font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; resize: vertical; }
.prev { margin: 0; font-size: 0.9rem; color: var(--muted); border-left: 3px solid var(--line); padding-left: 10px; white-space: pre-wrap; }
.overall { display: grid; gap: 8px; }
.done-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.primary { background: var(--accent); color: var(--accent-fg); border: 0; border-radius: 6px; padding: 8px 16px; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled, textarea:disabled, input:disabled { opacity: 0.55; cursor: not-allowed; }
.lightbox { position: fixed; inset: 0; z-index: 20; background: rgba(0, 0, 0, 0.88); display: grid; place-items: center; gap: 8px; padding: calc(env(safe-area-inset-top, 0px) + 48px) max(16px, env(safe-area-inset-right, 0px)) calc(env(safe-area-inset-bottom, 0px) + 16px) max(16px, env(safe-area-inset-left, 0px)); }
.lightbox img { max-width: 100%; max-height: 80vh; }
.lightbox p { color: #e6e9ed; margin: 0; }
.lightbox .close { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 12px); right: max(16px, env(safe-area-inset-right, 0px)); background: #e6e9ed; color: #111418; border: 0; border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
@media (prefers-reduced-motion: no-preference) { .frame { transition: filter 0.15s; } }
`;

// Plain JavaScript, with no template literals of its own, so it sits in this one unescaped.
const SCRIPT = `
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("review-data").textContent);
  var NO_CHANGE = data.noChange;
  var TAG_NAMES = { "too-busy": "Too busy", "too-flat": "Too flat", "seams": "Seams", "wrong-colour": "Wrong colour", "good": "Good" };
  var WHY = { missing: "No frame", late: "Captured late, so left off", wrong: "Shows another Shot's place, so left off" };
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, props, children) {
    var node = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (key) {
      if (key === "text") node.textContent = props[key];
      else if (key === "class") node.className = props[key];
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  };
  var shotName = function (shot) { return "Shot " + shot.shot + (shot.label ? " (" + shot.label + ")" : ""); };

  // What the author has set, as the db holds it (or will, once written).
  var feedback = { shots: {}, overall: { note: "" }, status: { done: false } };
  data.shots.forEach(function (shot) { feedback.shots[shot.shot] = { best: "", tags: [], note: "" }; });
  var writable = false;
  var db = null;
  var mode = "side";
  var flipIndex = 0;
  var controls = {};

  // Header and summary.
  $("eyebrow").textContent = "Still Review · set " + data.set;
  $("heading").textContent = data.map + ", round " + data.round;
  var facts = [["Map", data.map], ["Round", data.round], ["Lighting", data.lighting || "the map's own"], ["Shots", String(data.shots.length)]];
  if (data.previous) facts.push(["After", "round " + data.previous.round]);
  facts.forEach(function (pair) { $("facts").appendChild(el("div", null, [el("dt", { text: pair[0] }), el("dd", { text: pair[1] })])); });
  data.versions.forEach(function (version, i) {
    $("versions").appendChild(el("li", null, [el("b", { text: version.label }), document.createTextNode(version.note ? ": " + version.note : ""), el("span", { class: "hint", text: i < 9 ? "  key " + (i + 1) : "" })]));
  });
  var summary = $("summary");
  if (data.problems.length) {
    summary.appendChild(el("p", { text: data.problems.length + " frame(s) are left off the page and need a retake:" }));
    summary.appendChild(el("ul", null, data.problems.map(function (problem) {
      var why = problem.status === "wrong" ? "shows Shot " + problem.shows + "'s place" : problem.status === "late" ? "was captured late" : "has no frame";
      return el("li", { text: problem.version + ": " + shotName(problem) + " " + why });
    })));
  } else summary.appendChild(el("p", { text: "Every version has a frame of every Shot." }));
  if (data.unconfirmed.length) summary.appendChild(el("p", { text: data.unconfirmed.length + " frame(s) carry a badge: the check couldn't confirm they show their Shot's place, which a big repaint of the ground can cause." }));
  if (data.previous && data.previous.overall) { $("prev-overall").hidden = false; $("prev-overall").textContent = "Round " + data.previous.round + ": " + data.previous.overall; }

  // The flip view's version buttons.
  data.versions.forEach(function (version, i) {
    var button = el("button", { type: "button", "aria-pressed": i === 0 ? "true" : "false", text: version.label });
    button.addEventListener("click", function () { setFlip(i); });
    $("flip-picks").appendChild(button);
  });

  // The Shots.
  data.shots.forEach(function (shot) {
    var framesBox = el("div", { class: "frames" });
    var c = { frames: framesBox, best: {}, tags: {}, note: null };
    controls[shot.shot] = c;
    var head = el("div", { class: "shot-head" }, [el("span", { class: "num", text: "Shot " + shot.shot }), el("h3", { text: shot.label || "" })]);
    var pick = el("fieldset", { class: "pick" }, [el("legend", { text: "Best" })]);
    data.versions.map(function (v) { return v.label; }).concat([NO_CHANGE]).forEach(function (value, i) {
      var id = "best-" + shot.shot + "-" + i;
      var input = el("input", { type: "radio", name: "best-" + shot.shot, id: id, value: value });
      input.addEventListener("change", function () { if (input.checked) change(shot.shot, { best: value }); });
      c.best[value] = input;
      pick.appendChild(el("label", { for: id }, [input, document.createTextNode(value === NO_CHANGE ? "No change" : value)]));
    });
    var tags = el("div", { class: "tags", role: "group", "aria-label": "Tags" });
    data.tags.forEach(function (tag) {
      var button = el("button", { type: "button", class: "tag", "aria-pressed": "false", text: TAG_NAMES[tag] || tag });
      button.addEventListener("click", function () {
        var now = feedback.shots[shot.shot].tags.slice();
        var at = now.indexOf(tag);
        if (at >= 0) now.splice(at, 1); else now.push(tag);
        change(shot.shot, { tags: now });
      });
      c.tags[tag] = button;
      tags.appendChild(button);
    });
    var noteId = "note-" + shot.shot;
    var note = el("textarea", { id: noteId, rows: "2" });
    note.addEventListener("input", function () { change(shot.shot, { note: note.value }, true); });
    c.note = note;
    var parts = [head, framesBox, pick, tags, el("label", { class: "field", for: noteId, text: "Note" }), note];
    if (shot.previous) {
      var before = [];
      if (shot.previous.best) before.push("best " + (shot.previous.best === NO_CHANGE ? "no change" : shot.previous.best));
      if (shot.previous.tags.length) before.push(shot.previous.tags.map(function (t) { return TAG_NAMES[t] || t; }).join(", "));
      if (shot.previous.note) before.push(shot.previous.note);
      if (before.length) parts.push(el("p", { class: "prev", text: "Round " + (data.previous ? data.previous.round : "before") + ": " + before.join(" · ") }));
    }
    $("shots").appendChild(el("section", { class: "shot", id: "shot-" + shot.shot }, parts));
  });

  function frameNode(shot, entry) {
    var caption = el("figcaption", null, [el("b", { text: entry.version })]);
    if (!entry.frame) return el("figure", null, [el("div", { class: "gap", text: WHY[entry.status] || "No frame" }), caption]);
    var img = el("img", { class: "frame", src: entry.frame, alt: shotName(shot) + ", " + entry.version, loading: "lazy", tabindex: "0" });
    var open = function () { openLightbox(entry.frame, shotName(shot) + " · " + entry.version); };
    img.addEventListener("click", open);
    img.addEventListener("keydown", function (event) { if (event.key === "Enter") open(); });
    if (entry.status === "unconfirmed") caption.appendChild(el("span", { class: "badge", text: "unconfirmed place" }));
    return el("figure", null, [img, caption]);
  }
  function renderFrames() {
    data.shots.forEach(function (shot) {
      var box = controls[shot.shot].frames;
      box.className = mode === "flip" ? "frames flip" : "frames";
      box.textContent = "";
      var entries = mode === "flip" ? [shot.frames[flipIndex]] : shot.frames;
      entries.forEach(function (entry) { box.appendChild(frameNode(shot, entry)); });
    });
  }
  function setMode(next) {
    mode = next;
    $("mode-side").setAttribute("aria-pressed", String(mode === "side"));
    $("mode-flip").setAttribute("aria-pressed", String(mode === "flip"));
    $("flip-picks").hidden = mode !== "flip";
    renderFrames();
  }
  function setFlip(i) {
    flipIndex = i;
    Array.prototype.forEach.call($("flip-picks").children, function (button, at) { button.setAttribute("aria-pressed", String(at === i)); });
    setMode("flip");
  }
  $("mode-side").addEventListener("click", function () { setMode("side"); });
  $("mode-flip").addEventListener("click", function () { setFlip(flipIndex); });
  $("lift").addEventListener("change", function () { document.body.classList.toggle("lifted", $("lift").checked); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !$("lightbox").hidden) { closeLightbox(); return; }
    var target = event.target;
    if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var n = Number(event.key);
    if (n >= 1 && n <= 9 && n <= data.versions.length) setFlip(n - 1);
  });
  function openLightbox(src, caption) { $("lightbox-img").src = src; $("lightbox-img").alt = caption; $("lightbox-caption").textContent = caption; $("lightbox").hidden = false; $("lightbox-close").focus(); }
  function closeLightbox() { $("lightbox").hidden = true; }
  $("lightbox-close").addEventListener("click", closeLightbox);
  $("lightbox").addEventListener("click", function (event) { if (event.target === $("lightbox")) closeLightbox(); });
  renderFrames();

  // Showing what the author has set.
  function showShot(n) {
    var f = feedback.shots[n], c = controls[n];
    Object.keys(c.best).forEach(function (value) { c.best[value].checked = f.best === value; });
    Object.keys(c.tags).forEach(function (tag) { c.tags[tag].setAttribute("aria-pressed", String(f.tags.indexOf(tag) >= 0)); });
    if (document.activeElement !== c.note) c.note.value = f.note;
  }
  function showReview() {
    if (document.activeElement !== $("overall-note")) $("overall-note").value = feedback.overall.note;
    $("done").textContent = feedback.status.done ? "Reviewing again" : "Done reviewing";
    $("done-state").textContent = feedback.status.done ? "Marked done." : "";
  }
  function setWritable(yes) {
    writable = yes;
    var nodes = document.querySelectorAll(".pick input, .tag, .shot textarea, #overall-note, #done");
    Array.prototype.forEach.call(nodes, function (node) { node.disabled = !yes; });
  }
  var saveState = function (text) { $("save-state").textContent = text; };

  // Writing: per document, one write at a time, after a pause in typing, and only on a change.
  var writers = {};
  function writer(path) { return writers[path] || (writers[path] = { timer: null, busy: false, next: null, last: null }); }
  function queue(path, body, typing) {
    var w = writer(path);
    w.next = body;
    clearTimeout(w.timer);
    w.timer = setTimeout(function () { flush(path); }, typing ? 800 : 250);
    saveState("Saving…");
  }
  function flush(path) {
    var w = writer(path);
    if (w.busy || !w.next || !db) return;
    var body = w.next, json = JSON.stringify(body);
    w.next = null;
    if (json === w.last) { settle(); return; }
    w.busy = true;
    // A transient failure is retried once, after a short random wait; any other is reported, and
    // the next change to the document writes it again.
    var attempt = function (retried) {
      return db.doc(path).set(body).then(function () { w.last = json; w.failed = null; }, function (error) {
        var code = error && error.code;
        if ((code === "unavailable" || !code) && !retried) return new Promise(function (resolve) { setTimeout(resolve, 500 + Math.random() * 1000); }).then(function () { return attempt(true); });
        if (code === "invalid_argument" || code === "transform_error" || code === "revoked" || code === "not_granted" || code === "capability_disabled" || code === "capability_removed") { setWritable(false); w.failed = "Can't save here: your changes stay on this screen only."; }
        else if (code === "quota_exceeded") w.failed = "The review's storage is full, so this change wasn't saved.";
        else if (code === "resource_exhausted") w.failed = "Too many saves at once: this change wasn't saved. Make it again in a moment.";
        else w.failed = "This change wasn't saved: the connection dropped. Make it again to retry.";
      });
    };
    attempt(false).then(function () { w.busy = false; if (w.next) flush(path); else settle(); });
  }
  var pending = function (path) { var w = writers[path]; return !!(w && (w.busy || w.next)); };
  function settle() {
    var paths = Object.keys(writers);
    if (paths.some(pending)) return;
    var failure = paths.map(function (path) { return writers[path].failed; }).filter(Boolean)[0];
    saveState(failure || (writable ? "Saved" : "Read-only"));
  }
  function change(n, patch, typing) {
    if (!writable) return;
    var f = feedback.shots[n];
    Object.keys(patch).forEach(function (key) { f[key] = patch[key]; });
    showShot(n);
    queue("shots/" + n, { best: f.best, tags: f.tags.slice(), note: f.note }, typing);
  }
  $("overall-note").addEventListener("input", function () { if (!writable) return; feedback.overall = { note: $("overall-note").value }; queue("review/overall", { note: feedback.overall.note }, true); });
  $("done").addEventListener("click", function () { if (!writable) return; feedback.status = { done: !feedback.status.done }; showReview(); queue("review/status", { done: feedback.status.done }); });

  data.shots.forEach(function (shot) { showShot(shot.shot); });
  showReview();
  setWritable(false);
  saveState("Loading saved feedback…");

  // The db, when this view has one.
  var start = window.claude && typeof window.claude.use === "function" ? window.claude : null;
  if (!start) { saveState("Read-only: open the published page to give feedback."); return; }
  Promise.all([start.use("db"), start.use("user").catch(function () { return null; })]).then(function (found) {
    db = found[0];
    var user = found[1];
    if (!db) { saveState("Read-only: feedback can't be saved in this view."); return; }
    var mayWrite = user ? user.can("data.write") : Promise.resolve(null);
    return mayWrite.then(function (can) {
      // null: the platform said nothing, so keep the controls and let a refused write decide.
      setWritable(can !== false);
      subscribe();
    });
  }).catch(function () { saveState("Read-only: feedback can't be saved in this view."); });

  function subscribe() {
    var confirmed = { shots: false, overall: false, status: false };
    var timer = setTimeout(function () { saveState("Saved feedback can't be reached yet; what you see may be out of date."); }, 10000);
    var landed = function (which, snap) {
      if (!snap.metadata.fromCache) confirmed[which] = true;
      if (confirmed.shots && confirmed.overall && confirmed.status) { clearTimeout(timer); settle(); }
    };
    var failed = function (error) {
      clearTimeout(timer);
      if (error && error.code === "revoked") { setWritable(false); saveState("Read-only"); }
      else saveState("Saved feedback stopped updating; reload the page to see others' changes.");
    };
    // Each listener is opened once; one the page's host dropped (unavailable) is opened again, once.
    var listen = function (ref, next) {
      var reopened = false;
      var open = function () {
        ref.onSnapshot(next, function (error) {
          if (error && error.code === "unavailable" && !reopened) { reopened = true; open(); return; }
          failed(error);
        });
      };
      open();
    };
    listen(db.collection("shots"), function (snap) {
      snap.docs.forEach(function (doc) {
        var n = Number(doc.id);
        if (!feedback.shots[n] || !doc.exists || pending("shots/" + doc.id)) return;
        var body = doc.data() || {};
        var next = { best: typeof body.best === "string" ? body.best : "", tags: Array.isArray(body.tags) ? body.tags.filter(function (t) { return typeof t === "string"; }) : [], note: typeof body.note === "string" ? body.note : "" };
        feedback.shots[n] = next;
        writer("shots/" + doc.id).last = JSON.stringify(next);
        showShot(n);
      });
      landed("shots", snap);
    });
    listen(db.doc("review/overall"), function (doc) {
      if (doc.exists && !pending("review/overall")) {
        var body = doc.data() || {};
        feedback.overall = { note: typeof body.note === "string" ? body.note : "" };
        writer("review/overall").last = JSON.stringify(feedback.overall);
        showReview();
      }
      landed("overall", doc);
    });
    listen(db.doc("review/status"), function (doc) {
      if (doc.exists && !pending("review/status")) {
        feedback.status = { done: (doc.data() || {}).done === true };
        writer("review/status").last = JSON.stringify(feedback.status);
        showReview();
      }
      landed("status", doc);
    });
  }
})();
`;
