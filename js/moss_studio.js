import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { seedApi } from "./kreative_seed.js";
import { keepImages } from "./kreative_keep.js";

// ---------------------------------------------------------------------------
// Moss Studio: a calm, one-screen front end for the Moss v5 workflow.
// It only changes the real graph (widgets + group mute), so "Show full
// workflow" always shows exactly what the Studio set up.
// ---------------------------------------------------------------------------

const LOOKS = [
    { key: "A", match: "LOOK A", icon: "⬜", name: "Clean", help: "No film look. A clear, natural photo." },
    { key: "B", match: "LOOK B", icon: "🎞️", name: "1970s Kodachrome", help: "Warm, faded 70s film snapshot." },
    { key: "C", match: "LOOK C", icon: "📱", name: "Cheap iPhone", help: "Grainy phone photo. JPEG crunch is always on." },
    { key: "D", match: "LOOK D", icon: "🌺", name: "Aerochrome", help: "Infrared film: plants turn red and pink." },
    { key: "E", match: "LOOK E", icon: "🧪", name: "Aerochrome IR", help: "Experimental. Two passes, slower.", badge: "Experimental" },
];
const PEOPLE = [
    { key: "A", match: "PEOPLE A", icon: "🧑", name: "Caucasian", help: "People are European unless your idea says otherwise." },
    { key: "B", match: "PEOPLE B", icon: "🧑", name: "Asian", help: "People are East Asian unless your idea says otherwise." },
    { key: "C", match: "PEOPLE C", icon: "📝", name: "As in my idea", help: "Follows your words exactly. Use for mixed groups." },
    { key: "D", match: "PEOPLE D", icon: "🏞️", name: "No people", help: "Places and things only." },
];
const SHAPES = [
    { ratio: "2:3", icon: "▯", name: "Portrait" },
    { ratio: "1:1", icon: "□", name: "Square" },
    { ratio: "3:2", icon: "▭", name: "Landscape" },
    { ratio: "16:9", icon: "▬", name: "Wide" },
    { ratio: "9:16", icon: "▮", name: "Tall phone" },
];
const POLISH_MATCH = "Second pass";

const STAGES = [
    { test: (n) => n.type === "TextGenerate", text: "✍️  Writing your prompt…" },
    { test: (n) => n.type === "KSampler" && /first pass/i.test(n.title || ""), text: "🎨  Painting your picture…" },
    { test: (n) => n.type === "KSampler" && /second pass/i.test(n.title || ""), text: "✨  Polishing…" },
    { test: (n) => n.type === "KSampler" && /IR PASS/i.test(n.title || ""), text: "🌈  Infrared pass…" },
    { test: (n) => n.type === "FaceDetailer", text: "🙂  Fixing faces…" },
    { test: (n) => /^SeedVR2/.test(n.type), text: "🔍  Adding fine detail…" },
    { test: (n) => n.type === "ProPostFilmGrain", text: "🎞️  Adding grain…" },
    { test: (n) => n.type === "KreativeJPEGCrunch", text: "📱  Phone compression…" },
    { test: (n) => /Loader/.test(n.type), text: "📦  Loading models (first run is slow)…" },
];

// ---------- graph helpers ----------
const G = () => app.graph;
const nodesOf = (type) => (G()?._nodes || G()?.nodes || []).filter((n) => n.type === type);
const nodeOf = (type) => nodesOf(type)[0];
const byId = (id) => G()?.getNodeById?.(Number(id)) || G()?.getNodeById?.(id);
const widget = (node, name) => node?.widgets?.find((w) => w.name === name);
function setWidget(node, name, value) {
    const w = widget(node, name);
    if (!w) return;
    w.value = value;
    w.callback?.(value);
}
const groups = () => G()?._groups || G()?.groups || [];
function rect(g) {
    const b = g._bounding || g.bounding;
    if (b && b.length >= 4) return [b[0], b[1], b[2], b[3]];
    return [g.pos[0], g.pos[1], g.size[0], g.size[1]];
}
function nodesInGroup(g) {
    const [x, y, w, h] = rect(g);
    return (G()?._nodes || []).filter((n) => n.pos[0] >= x && n.pos[1] >= y && n.pos[0] < x + w && n.pos[1] < y + h);
}
const findGroup = (prefix) => groups().find((g) => (g.title || "").startsWith(prefix));
const findGroupContaining = (text) => groups().find((g) => (g.title || "").includes(text));
const groupOn = (g) => !!g && nodesInGroup(g).some((n) => n.mode === 0);
function setGroup(g, on) {
    if (!g) return;
    nodesInGroup(g).forEach((n) => (n.mode = on ? 0 : 2));
}
function pickRadio(list, key) {
    list.forEach((item) => setGroup(findGroup(item.match), item.key === key));
    G()?.setDirtyCanvas(true, true);
}
const currentRadio = (list) => list.find((item) => groupOn(findGroup(item.match)))?.key;

// idea rows (KreativePromptMulti)
function readRows() {
    const n = nodeOf("KreativePromptMulti");
    try { return JSON.parse(widget(n, "prompt_data")?.value || "[]"); } catch { return []; }
}
function writeRows(rows) {
    const n = nodeOf("KreativePromptMulti");
    if (!n) return;
    setWidget(n, "prompt_data", JSON.stringify(rows));
    n.properties = n.properties || {};
    n.properties.promptMultiState = { version: 2, mode: "queue", rows };
    n._kreativeRenderRows?.();
}

// shape (KreativeResolutionFocal)
function readShape() {
    const n = nodeOf("KreativeResolutionFocal");
    try { return JSON.parse(widget(n, "ui_state")?.value || "{}").ratio; } catch { return null; }
}
function writeShape(ratio) {
    const n = nodeOf("KreativeResolutionFocal");
    if (!n) return;
    let s = {};
    try { s = JSON.parse(widget(n, "ui_state")?.value || "{}"); } catch { /* new state */ }
    s.ratio = ratio;
    setWidget(n, "ui_state", JSON.stringify(s));
    if (widget(n, "auto_ratio")?.value) setWidget(n, "auto_ratio", false);
    n._kreativeResolutionRender?.();
}

const stepsNode = () => (G()?._nodes || []).find((n) => n.type === "PrimitiveInt" && /^1f\./.test(n.title || ""));

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") el.className = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => c != null && el.append(c.nodeType ? c : document.createTextNode(String(c))));
    return el;
}

const CSS = `
.ks-root{--bg:#FAF7F0;--card:#FFFFFF;--line:#D6CFC2;--text:#1D1D1B;--soft:#5A574F;--accent:#1E6A49;--accent-ink:#FFFFFF;--chosen:#E4F2EA;--focus:#F2B705;--warn:#8A3B12;
 position:fixed;inset:0;z-index:1100;background:var(--bg);color:var(--text);overflow:auto;
 font-family:"Atkinson Hyperlegible","Lexend",Verdana,Tahoma,sans-serif;font-size:18px;line-height:1.5;letter-spacing:.02em;text-align:left}
@media (prefers-color-scheme:dark){.ks-root{--bg:#1C1C1A;--card:#262624;--line:#45423C;--text:#EEE9DF;--soft:#B8B2A6;--accent:#5FBF8F;--accent-ink:#10251A;--chosen:#22382C;--warn:#F0A47A}}
.ks-root *{box-sizing:border-box;font-family:inherit}
.ks-root button{font-size:18px;min-height:52px;border-radius:12px;border:2px solid var(--line);background:var(--card);color:var(--text);cursor:pointer;padding:8px 16px}
.ks-root button:hover{border-color:var(--accent)}
.ks-root :focus-visible{outline:4px solid var(--focus);outline-offset:2px}
.ks-top{position:sticky;top:0;z-index:2;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 24px;background:var(--bg);border-bottom:2px solid var(--line)}
.ks-top h1{font-size:26px;margin:0}
.ks-wrap{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:24px;padding:24px;max-width:1500px;margin:0 auto}
@media (max-width:1000px){.ks-wrap{grid-template-columns:1fr}}
.ks-step{background:var(--card);border:2px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:16px}
.ks-step h2{font-size:21px;margin:0 0 10px;display:flex;align-items:center;gap:10px}
.ks-num{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-size:18px;flex:none}
.ks-help{background:none !important;border:none !important;min-height:auto !important;padding:0 6px !important;color:var(--soft) !important;text-decoration:underline;font-size:16px !important;margin-left:auto}
.ks-helptext{color:var(--soft);margin:0 0 10px;font-size:16px}
.ks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.ks-card{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;min-height:84px !important}
.ks-card .ic{font-size:26px;line-height:1}
.ks-card .nm{font-weight:700}
.ks-card .tag{font-size:14px;color:var(--warn);font-weight:700}
.ks-card[aria-checked="true"],.ks-card[aria-pressed="true"]{border:3px solid var(--accent);background:var(--chosen)}
.ks-card[aria-checked="true"] .nm::after,.ks-card[aria-pressed="true"] .nm::after{content:"  ✓"}
.ks-root textarea{width:100%;min-height:120px;font-size:19px;line-height:1.55;padding:12px;border-radius:12px;border:2px solid var(--line);background:var(--card);color:var(--text);resize:vertical}
.ks-root select{font-size:17px;min-height:48px;border-radius:10px;border:2px solid var(--line);background:var(--card);color:var(--text);padding:6px 10px;max-width:100%}
.ks-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}
.ks-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left}
.ks-switch .state{font-weight:700;min-width:64px;text-align:center;border-radius:8px;padding:4px 8px;border:2px solid var(--line)}
.ks-switch[aria-pressed="true"]{border:3px solid var(--accent);background:var(--chosen)}
.ks-switch[aria-pressed="true"] .state{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.ks-sub{color:var(--soft);font-size:16px}
.ks-seed{font-size:34px !important;font-weight:700;width:220px;min-height:60px;text-align:center;border-radius:12px;border:2px solid var(--line);background:var(--card);color:var(--text)}
.ks-range{width:100%;accent-color:var(--accent);height:36px}
.ks-make{width:100%;min-height:76px !important;font-size:24px !important;font-weight:700;background:var(--accent) !important;color:var(--accent-ink) !important;border-color:var(--accent) !important}
.ks-make[disabled]{opacity:.6;cursor:wait}
.ks-side{position:sticky;top:88px;align-self:start}
.ks-bar{height:14px;border-radius:7px;background:var(--line);overflow:hidden;margin:12px 0 6px}
.ks-bar>div{height:100%;width:0;background:var(--accent);transition:width .3s}
@media (prefers-reduced-motion:reduce){.ks-bar>div{transition:none}}
.ks-stage{font-size:20px;min-height:30px}
.ks-result{margin-top:12px;border:2px dashed var(--line);border-radius:16px;min-height:300px;display:flex;align-items:center;justify-content:center;color:var(--soft);overflow:hidden;background:var(--card)}
.ks-result img{max-width:100%;max-height:70vh;display:block}
.ks-status{margin-top:8px;font-weight:700}
.ks-pill{position:fixed;right:18px;top:64px;z-index:1101;font-family:"Atkinson Hyperlegible",Verdana,sans-serif;font-size:17px;font-weight:700;padding:10px 18px;border-radius:999px;border:2px solid #1E6A49;background:#1E6A49;color:#fff;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25)}
.ks-pill:focus-visible{outline:4px solid #F2B705;outline-offset:2px}
.ks-missing{padding:40px;max-width:700px;margin:40px auto;font-size:20px}
`;

class Studio {
    constructor() {
        this.open = false;
        this.running = false;
        this.lastImages = [];
        this.kept = false;
        this.help = {};
        this.stage = "Ready when you are.";
        this.progress = 0;
        this.status = "";
        this.mountStatic();
        this.listen();
    }

    mountStatic() {
        if (!document.getElementById("ks-font")) {
            document.head.append(h("link", { id: "ks-font", rel: "stylesheet",
                href: "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap" }));
        }
        document.head.append(h("style", {}, CSS));
        this.pill = h("button", { class: "ks-pill", type: "button", onclick: () => this.toggle() }, "🌿 Moss Studio");
        document.body.append(this.pill);
        this.root = h("div", { class: "ks-root", role: "dialog", "aria-label": "Moss Studio" });
        this.root.style.display = "none";
        this.pill.style.display = "none";
        document.body.append(this.root);
        this.root.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.make(); }
            e.stopPropagation(); // keep ComfyUI shortcuts away from typing
        });
    }

    toggle(force) {
        this.open = force ?? !this.open;
        try { localStorage.setItem("kreativeStudioOpen", this.open ? "1" : "0"); } catch { /* storage blocked */ }
        this.root.style.display = this.open ? "block" : "none";
        this.pill.textContent = this.open ? "⚙ Show full workflow" : "🌿 Moss Studio";
        this.updatePill();
        if (this.open) this.render();
    }

    updatePill() {
        this.pill.style.display = !this.open && this.compatible() ? "block" : "none";
    }

    compatible() {
        return nodeOf("KreativeSeed") && nodeOf("KreativeKeep") && findGroup("LOOK A");
    }

    // ---------- building blocks ----------
    step(num, title, helpKey, helpText, ...body) {
        const shown = this.help[helpKey];
        return h("section", { class: "ks-step", "aria-labelledby": `ks-h-${helpKey}` },
            h("h2", { id: `ks-h-${helpKey}` }, h("span", { class: "ks-num", "aria-hidden": "true" }, num), title,
                h("button", { class: "ks-help", type: "button", "aria-expanded": shown ? "true" : "false",
                    onclick: () => { this.help[helpKey] = !shown; this.render(); } }, shown ? "Hide help" : "What's this?")),
            shown ? h("p", { class: "ks-helptext" }, helpText) : null,
            ...body);
    }

    radioCards(list, current, onPick, label) {
        return h("div", { class: "ks-grid", role: "radiogroup", "aria-label": label },
            list.map((item) => h("button", {
                class: "ks-card", type: "button", role: "radio", "aria-checked": item.key === current ? "true" : "false",
                title: item.help, onclick: () => { onPick(item.key); this.render(); },
            }, h("span", { class: "ic", "aria-hidden": "true" }, item.icon), h("span", { class: "nm" }, item.name),
                item.badge ? h("span", { class: "tag" }, item.badge) : null)));
    }

    switchBtn(name, sub, on, onToggle) {
        return h("button", { class: "ks-card ks-switch", type: "button", "aria-pressed": on ? "true" : "false",
            onclick: () => { onToggle(!on); this.render(); } },
            h("span", {}, h("span", { class: "nm" }, name), h("br"), h("span", { class: "ks-sub" }, sub)),
            h("span", { class: "state" }, on ? "ON" : "OFF"));
    }

    // ---------- render ----------
    render() {
        if (!this.open) return;
        const focusId = document.activeElement?.dataset?.ksid;
        this.root.replaceChildren(this.view());
        if (focusId) this.root.querySelector(`[data-ksid="${focusId}"]`)?.focus();
    }

    view() {
        const top = h("header", { class: "ks-top" },
            h("h1", {}, "🌿 Moss Studio"),
            h("button", { type: "button", onclick: () => this.toggle(false) }, "⚙ Show full workflow"));
        if (!this.compatible()) {
            return h("div", {}, top, h("div", { class: "ks-missing" },
                h("p", {}, "This screen works with the Moss v5 workflow."),
                h("p", {}, "Open moss-image-sft_v5 from your workflows, then click 🌿 Moss Studio again.")));
        }
        return h("div", {}, top, h("main", { class: "ks-wrap" },
            h("div", {}, this.ideaStep(), this.lookStep(), this.peopleStep(), this.shapeStep(), this.extrasStep(), this.seedStep()),
            h("aside", { class: "ks-side", "aria-live": "polite" }, this.makePanel())));
    }

    ideaStep() {
        const rows = readRows();
        let active = rows.findIndex((r) => r.enabled);
        if (active < 0 && rows.length) active = 0;
        const ta = h("textarea", { "data-ksid": "idea", "aria-label": "Your idea",
            placeholder: "Say what you want to see. For example: a fox in a misty forest at sunrise" });
        ta.value = rows[active]?.text || "";
        ta.addEventListener("input", () => {
            const r = readRows();
            let i = r.findIndex((x) => x.enabled);
            if (i < 0) { r.push({ enabled: true, text: "" }); i = r.length - 1; }
            r[i].text = ta.value;
            writeRows(r);
        });
        const pick = h("select", { "aria-label": "Pick a saved idea", "data-ksid": "ideapick",
            onchange: (e) => {
                const r = readRows().map((x, i) => ({ ...x, enabled: i === Number(e.target.value) }));
                writeRows(r); this.render();
            } },
            rows.map((r, i) => h("option", { value: i, selected: i === active }, `${i + 1}. ${(r.text || "(empty)").slice(0, 60)}`)));
        const add = h("button", { type: "button", onclick: () => {
            const r = readRows().map((x) => ({ ...x, enabled: false }));
            r.push({ enabled: true, text: "" }); writeRows(r); this.render();
            this.root.querySelector('[data-ksid="idea"]')?.focus();
        } }, "＋ New idea");
        return this.step(1, "Your idea", "idea",
            "Write it like you'd say it. The AI turns it into a full description for you.",
            ta, h("div", { class: "ks-row" }, pick, add));
    }

    lookStep() {
        return this.step(2, "Pick a look", "look", "Changes the film or camera style. Pick one.",
            this.radioCards(LOOKS, currentRadio(LOOKS), (k) => pickRadio(LOOKS, k), "Look"));
    }

    peopleStep() {
        return this.step(3, "People", "people", "Who appears in the picture.",
            this.radioCards(PEOPLE, currentRadio(PEOPLE), (k) => pickRadio(PEOPLE, k), "People"));
    }

    shapeStep() {
        const cur = readShape();
        return this.step(4, "Shape", "shape", "The shape of the picture. More sizes and lenses are in the full workflow.",
            h("div", { class: "ks-grid", role: "radiogroup", "aria-label": "Shape" },
                SHAPES.map((s) => h("button", { class: "ks-card", type: "button", role: "radio",
                    "aria-checked": s.ratio === cur ? "true" : "false",
                    onclick: () => { writeShape(s.ratio); this.render(); } },
                h("span", { class: "ic", "aria-hidden": "true" }, s.icon), h("span", { class: "nm" }, s.name),
                h("span", { class: "ks-sub" }, s.ratio)))));
    }

    extrasStep() {
        const polishG = findGroupContaining("Second pass");
        const face = nodeOf("KreativeImageOnOff");
        const mix = nodeOf("KreativeDetailMix");
        const jpg = nodeOf("KreativeJPEGCrunch");
        const steps = stepsNode();
        const st = {
            polish: groupOn(polishG),
            face: !!widget(face, "switch")?.value,
            detail: !!widget(mix, "switch")?.value,
            jpeg: !!widget(jpg, "switch")?.value,
            steps: Number(widget(steps, "value")?.value || 0),
        };
        const preset = (p) => {
            const best = p === "best";
            setGroup(polishG, best);
            setWidget(face, "switch", best);
            setWidget(mix, "switch", best);
            if (steps) setWidget(steps, "value", best ? 50 : 25);
            G()?.setDirtyCanvas(true, true);
            this.render();
        };
        const isQuick = !st.polish && !st.face && !st.detail && st.steps <= 25;
        const isBest = st.polish && st.face && st.detail && st.steps >= 50;
        const mixVal = Number(widget(mix, "detail_mix")?.value ?? 0.5);
        const slider = h("input", { type: "range", class: "ks-range", min: 0, max: 1, step: 0.05, value: mixVal,
            "aria-label": "Detail mix: keep the grit or clean detail", "data-ksid": "mix",
            onchange: (e) => { setWidget(mix, "detail_mix", Number(e.target.value)); this.render(); } });
        return this.step(5, "Quality and extras", "extras",
            "Quick test is fast for trying ideas. Best quality adds polish, face fix and detail. Switch any extra on or off.",
            h("div", { class: "ks-grid", role: "group", "aria-label": "Quality preset" },
                h("button", { class: "ks-card", type: "button", "aria-pressed": isQuick ? "true" : "false", onclick: () => preset("quick") },
                    h("span", { class: "ic", "aria-hidden": "true" }, "⚡"), h("span", { class: "nm" }, "Quick test"), h("span", { class: "ks-sub" }, "Fast")),
                h("button", { class: "ks-card", type: "button", "aria-pressed": isBest ? "true" : "false", onclick: () => preset("best") },
                    h("span", { class: "ic", "aria-hidden": "true" }, "✨"), h("span", { class: "nm" }, "Best quality"), h("span", { class: "ks-sub" }, "Slower"))),
            h("div", { style: "display:grid;gap:10px;margin-top:12px" },
                this.switchBtn("Polish", "A second, finer pass", st.polish, (v) => { setGroup(polishG, v); G()?.setDirtyCanvas(true, true); }),
                this.switchBtn("Face fix", "Fixes small or far-away faces", st.face, (v) => setWidget(face, "switch", v)),
                this.switchBtn("Detail (SeedVR2)", "Sharper fine detail", st.detail, (v) => setWidget(mix, "switch", v)),
                st.detail ? h("div", { class: "ks-step", style: "margin:0" },
                    h("div", { class: "ks-row", style: "justify-content:space-between;margin:0" },
                        h("span", {}, "Keep the grit"), h("strong", {}, `${Math.round(mixVal * 100)}%`), h("span", {}, "Clean detail")),
                    slider) : null,
                this.switchBtn("JPEG crunch", currentRadio(LOOKS) === "C" ? "Always on for the iPhone look" : "Phone-style compression",
                    st.jpeg || currentRadio(LOOKS) === "C", (v) => setWidget(jpg, "switch", v))));
    }

    seedStep() {
        const s = seedApi(nodeOf("KreativeSeed"));
        const locked = s.isLocked();
        const prev = nodeOf("KreativeSeed")._kHistory?.slice(-1)[0];
        const input = h("input", { class: "ks-seed", type: "number", min: 0, value: s.get(), "aria-label": "Seed number", "data-ksid": "seed",
            onchange: (e) => { s.set(e.target.value); this.render(); } });
        const b = (txt, fn, id, lbl) => h("button", { type: "button", "data-ksid": id, "aria-label": lbl || txt, onclick: () => { fn(); this.render(); } }, txt);
        return this.step(6, "Seed", "seed",
            "The seed is the picture's ID. Same seed and settings = same picture. +1 or −1 gives a close cousin.",
            h("div", { class: "ks-row", style: "margin-top:0" }, b("−1", s.down, "sdown", "Seed down by one"), input, b("+1", s.up, "sup", "Seed up by one"),
                b("🎲 New", s.random, "snew", "New random seed")),
            h("div", { class: "ks-row" },
                h("button", { class: "ks-card ks-switch", type: "button", "aria-pressed": locked ? "true" : "false", style: "min-height:52px;max-width:360px",
                    onclick: () => { s.setLocked(!locked); this.render(); } },
                    h("span", { class: "nm" }, locked ? "🔒 Seed locked" : "🎲 New seed each run"),
                    h("span", { class: "state" }, locked ? "LOCK" : "NEW")),
                prev !== undefined ? b(`↩ Back to ${prev}`, s.previous, "sprev") : null));
    }

    makePanel() {
        const img = this.lastImages[0];
        const src = img ? api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder || "")}&t=${this.stamp}`) : null;
        return h("div", {},
            h("button", { class: "ks-make", type: "button", disabled: this.running, "data-ksid": "make", onclick: () => this.make() },
                this.running ? "Working…" : "▶  Make my picture"),
            h("div", { class: "ks-sub", style: "margin-top:6px" }, "Shortcut: Ctrl + Enter"),
            h("div", { class: "ks-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(this.progress * 100) },
                h("div", { style: `width:${Math.round(this.progress * 100)}%` })),
            h("div", { class: "ks-stage" }, this.stage),
            h("div", { class: "ks-result" }, src ? h("img", { src, alt: "Your picture" }) : "Your picture will appear here"),
            img ? h("div", { class: "ks-row" },
                h("button", { type: "button", "data-ksid": "keep", onclick: () => this.keep(), style: "font-weight:700" }, this.kept ? "✓ Kept" : "💾  Keep it"),
                h("button", { type: "button", "data-ksid": "bin", onclick: () => this.bin() }, "🗑  Bin it"),
                h("a", { href: src, target: "_blank", rel: "noopener", style: "color:inherit;font-size:17px" }, "Open full size")) : null,
            h("div", { class: "ks-status" }, this.status));
    }

    // ---------- actions ----------
    async make() {
        if (this.running || !this.compatible()) return;
        this.running = true; this.progress = 0; this.stage = "Starting…"; this.status = "";
        this.render();
        try {
            await app.queuePrompt(0, 1);
        } catch (e) {
            this.running = false; this.stage = "Couldn't start. Check the full workflow for a red node.";
        }
        this.render();
    }

    async keep() {
        if (this.kept || !this.lastImages.length) return;
        this.status = "Saving…"; this.render();
        try {
            const names = await keepImages(this.lastImages, widget(nodeOf("KreativeKeep"), "filename_prefix")?.value);
            this.kept = true; this.status = `Saved ✓  ${names.join(", ")}`;
            const n = nodeOf("KreativeKeep"); if (n) { n._kKept = true; if (n._kStatus) n._kStatus.name = this.status; }
        } catch (e) {
            this.status = `Not saved: ${e.message}`;
        }
        this.render();
    }

    bin() {
        this.lastImages = []; this.kept = false; this.status = "Binned. Nothing was saved."; this.render();
    }

    // ---------- live progress ----------
    listen() {
        const nodeIdOf = (d) => (d && typeof d === "object" ? d.node ?? d.display_node : d);
        api.addEventListener("execution_start", () => { this.running = true; this.progress = 0; this.render(); });
        api.addEventListener("executing", (e) => {
            const id = nodeIdOf(e.detail);
            if (id == null) {
                this.running = false; this.progress = 1;
                if (!this.error) this.stage = this.lastImages.length ? "Done ✓" : "Done";
                this.error = false; this.render(); return;
            }
            const n = byId(String(id).split(":").pop());
            const st = n && STAGES.find((s) => s.test(n));
            if (st && st.text !== this.stage) { this.stage = st.text; this.progress = 0; this.render(); }
        });
        api.addEventListener("progress", (e) => {
            const { value, max } = e.detail || {};
            if (max) { this.progress = value / max; const bar = this.root.querySelector(".ks-bar>div"); if (bar) bar.style.width = `${Math.round(this.progress * 100)}%`; }
        });
        api.addEventListener("executed", (e) => {
            const d = e.detail || {};
            const n = byId(String(d.node ?? d.display_node).split(":").pop());
            if (n?.type !== "KreativeKeep") return;
            this.lastImages = d.output?.images || [];
            this.kept = !!d.output?.kreative_keep?.[0]?.auto_saved;
            this.status = this.kept ? "Auto-saved ✓" : "Not saved yet. Keep it or bin it.";
            this.stamp = Date.now();
            this.render();
        });
        api.addEventListener("execution_error", (e) => {
            this.running = false; this.error = true;
            const msg = e.detail?.exception_message || "";
            this.stage = /out of memory|OOM/i.test(msg)
                ? "Ran out of graphics memory. Try switching Detail off, or a smaller shape."
                : `Something went wrong: ${msg.slice(0, 160)}`;
            this.render();
        });
        api.addEventListener("execution_interrupted", () => { this.running = false; this.stage = "Stopped."; this.render(); });
    }
}

let studio = null;
app.registerExtension({
    name: "Kreative2AI.MossStudio",
    async setup() {
        studio = new Studio();
        let remembered = null;
        try { remembered = localStorage.getItem("kreativeStudioOpen"); } catch { /* storage blocked */ }
        setTimeout(() => {
            const auto = G()?.extra?.kreative_studio?.autoOpen;
            if (studio.compatible() && (remembered === "1" || (remembered == null && auto))) studio.toggle(true);
            studio.updatePill();
        }, 800);
    },
    async afterConfigureGraph() {
        if (!studio) return;
        if (G()?.extra?.kreative_studio?.autoOpen && studio.compatible()) studio.toggle(true);
        else if (studio.open) studio.render();
        studio.updatePill();
    },
});
