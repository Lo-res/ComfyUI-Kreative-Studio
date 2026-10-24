import { app } from "../../scripts/app.js";

// Control Panel: every widget switches real nodes / groups (also inside subgraphs),
// so the panel and the full workflow always agree.

const graphs = () => {
    const out = [app.graph];
    const subs = app.graph?.subgraphs;
    if (subs) for (const s of subs.values()) out.push(s);
    return out.filter(Boolean);
};
const nodesOf = (g) => g._nodes || g.nodes || [];
const groupsOf = (g) => g._groups || g.groups || [];
function rect(gr) {
    const b = gr._bounding || gr.bounding;
    if (b && b.length >= 4) return [b[0], b[1], b[2], b[3]];
    return [gr.pos[0], gr.pos[1], gr.size[0], gr.size[1]];
}
function inGroup(g, gr) {
    const [x, y, w, h] = rect(gr);
    return nodesOf(g).filter((n) => n.pos[0] >= x && n.pos[1] >= y && n.pos[0] < x + w && n.pos[1] < y + h);
}
function groups(test) {
    const out = [];
    for (const g of graphs()) for (const gr of groupsOf(g)) if (test(gr.title || "")) out.push([g, gr]);
    return out;
}
const isOn = (test) => groups(test).some(([g, gr]) => inGroup(g, gr).some((n) => n.mode === 0));
function setOn(test, on) {
    for (const [g, gr] of groups(test)) for (const n of inGroup(g, gr)) n.mode = on ? 0 : 2;
}
function findNode(test) {
    for (const g of graphs()) for (const n of nodesOf(g)) if (test(n)) return n;
    return null;
}
const wid = (n, name) => n?.widgets?.find((w) => w.name === name);
const letter = (v) => String(v || "").trim().charAt(0);

const T = {
    look: (L) => (t) => t.startsWith(`LOOK ${L}`),
    people: (L) => (t) => t.startsWith(`PEOPLE ${L}`),
    polish: (t) => t.includes("Second pass"),
    steps: () => findNode((n) => n.type === "PrimitiveInt" && /^1f\./.test(n.title || "")),
    face: () => findNode((n) => n.type === "KreativeImageOnOff"),
    detail: () => findNode((n) => n.type === "KreativeDetailMix"),
    jpeg: () => findNode((n) => n.type === "KreativeJPEGCrunch"),
};
const SWITCHES = { "face fix": "face", "detail (SeedVR2)": "detail", "JPEG crunch": "jpeg" };
const OWN = "✏️ Your own style (type it below)";
const LOOK_GROUP = (name) => (name === OWN ? "F" : name.charAt(0));
const LOOKS = (node) => (node.widgets || []).filter((w) => w.type !== "kreative_heading" &&
    (w.name === OWN || (/^[A-J] · /.test(w.name) && !PEOPLE_NAMES.has(w.name))));
const FLASH = "📸 camera flash (any look)";

// Flash add-on: the wording lives in "FLASH wording" inside the engine; the panel switch
// copies it into "FLASH add-on" (or empties it), which is joined onto every prompt.
function pushFlash(panel) {
    const on = !!wid(panel, FLASH)?.value;
    const src = findNode((n) => (n.title || "").startsWith("FLASH wording"));
    const dst = findNode((n) => (n.title || "").startsWith("FLASH add-on"));
    const w = wid(dst, "value");
    if (w) w.value = on ? String(wid(src, "value")?.value || "") : "";
}

// Extra negative for the current look (Polaroid: keep Moss from drawing the white instant-film frame).
const POLAROID_NEG = "white border, white frame, polaroid frame, instant film frame, photo frame, picture frame, " +
    "thick border, margin, framed print, photo of a photo, photo lying on a table";
function pushNegative(panel) {
    const polaroid = LOOKS(panel).some((w) => LOOK_GROUP(w.name) === "J" && w.value);
    const n = findNode((x) => (x.title || "").startsWith("Look extra negative"));
    const w = wid(n, "value");
    if (w) w.value = polaroid ? POLAROID_NEG : "";
}

// Look side-effects: Polaroid = no sharpening, no SeedVR2, fixed lens; Tri-X = grey grain.
function lookEffects(panel) {
    const on = (L) => LOOKS(panel).some((w) => LOOK_GROUP(w.name) === L && w.value);
    const polaroid = on("J");
    pushNegative(panel);
    const sharpen = findNode((n) => n.type === "ImageSharpen");
    if (sharpen) sharpen.mode = polaroid ? 4 : 0;
    const res = findNode((n) => n.type === "KreativeResolutionFocal");
    const st = wid(res, "ui_state");
    if (st) {
        let state = {};
        try { state = JSON.parse(st.value || "{}"); } catch { /* keep default */ }
        panel.properties = panel.properties || {};
        if (polaroid && state.focal !== "Off") {
            panel.properties.kPrevFocal = state.focal; state.focal = "Off";
            st.value = JSON.stringify(state); res._kreativeResolutionRender?.();
        } else if (!polaroid && panel.properties.kPrevFocal) {
            state.focal = panel.properties.kPrevFocal; delete panel.properties.kPrevFocal;
            st.value = JSON.stringify(state); res._kreativeResolutionRender?.();
        }
    }
    if (polaroid) {
        const d = wid(T.detail(), "switch"); if (d) d.value = false;
        const pd = wid(panel, "detail (SeedVR2)"); if (pd) pd.value = false;
    }
    const grain = findNode((n) => n.type === "ProPostFilmGrain");
    const gw = wid(grain, "gray_scale"); if (gw) gw.value = on("H");
}

// Your own style: first sentence -> look prefix, the rest -> look description (inside the engine).
function pushStyle(panel) {
    const text = String(wid(panel, "your own style")?.value || "").trim();
    const m = text.match(/^(.*?[.!?])\s+([\s\S]+)$/);
    const prefix = m ? m[1] : text;
    const desc = m ? m[2] : text;
    const pre = findNode((n) => (n.title || "").startsWith("LOOK F prefix"));
    const des = findNode((n) => (n.title || "").startsWith("LOOK F description"));
    if (pre) { const w = wid(pre, "value"); if (w) w.value = prefix; }
    if (des) { const w = wid(des, "value"); if (w) w.value = desc; }
}
const PEOPLE_NAMES = new Set(["A · Caucasian", "B · Asian", "C · As in my idea", "D · No people"]);
const PEOPLE = (node) => (node.widgets || []).filter((w) => PEOPLE_NAMES.has(w.name));

function redraw() {
    app.graph?.setDirtyCanvas(true, true);
    app.canvas?.setDirty?.(true, true);
}

// ---- section headings (drawn on the node, never saved) ----
export function addHeading(node, beforeName, text) {
    const lines = String(text).split("\n");
    const idx = node.widgets?.findIndex((w) => w.name === beforeName);
    if (idx == null || idx < 0) return;
    const h = {
        name: `heading_${beforeName}`, type: "kreative_heading", value: null, serialize: false,
        options: { serialize: false },
        draw(ctx, n, width, y, H) {
            ctx.save();
            ctx.fillStyle = "#F2E6C9";
            ctx.font = "bold 15px Verdana, sans-serif";
            ctx.textBaseline = "middle";
            lines.forEach((ln, i) => {
                ctx.font = i === 0 ? "bold 15px Verdana, sans-serif" : "13px Verdana, sans-serif";
                ctx.fillStyle = i === 0 ? "#F2E6C9" : "#FFD58A";
                ctx.fillText(ln, 14, y + 15 + i * 20);
            });
            const bottom = y + 27 + (lines.length - 1) * 20;
            ctx.strokeStyle = "rgba(242,230,201,0.35)";
            ctx.beginPath(); ctx.moveTo(14, bottom); ctx.lineTo(width - 14, bottom); ctx.stroke();
            ctx.restore();
        },
        computeSize: (width) => [width, 32 + (lines.length - 1) * 20],
    };
    node.addCustomWidget(h);
    node.widgets.splice(idx, 0, node.widgets.pop());
}

function radio(node, group, changed) {
    const list = group(node);
    if (changed.value) list.forEach((w) => { if (w !== changed) w.value = false; });
    else if (!list.some((w) => w.value)) changed.value = true; // always keep one on
}

function apply(node, w) {
    const name = w.name;
    const L = name.charAt(0);
    if (PEOPLE_NAMES.has(name)) {
        radio(node, PEOPLE, w);
        PEOPLE(node).forEach((x) => setOn(T.people(x.name.charAt(0)), !!x.value));
    } else if (name === OWN || /^[A-J] · /.test(name)) {
        radio(node, LOOKS, w);
        LOOKS(node).forEach((x) => setOn(T.look(LOOK_GROUP(x.name)), !!x.value));
        pushStyle(node);
        lookEffects(node);
    } else if (name === FLASH) pushFlash(node);
    else if (name === "your own style") pushStyle(node);
    else if (name === "second pass") setOn(T.polish, !!w.value);
    else if (name === "steps") { const t = wid(T.steps(), "value"); if (t) t.value = w.value; }
    else if (SWITCHES[name]) { const t = wid(T[SWITCHES[name]](), "switch"); if (t) t.value = !!w.value; }
    redraw();
}

function sync(panel) {
    const set = (name, v) => { const w = wid(panel, name); if (w && v !== undefined) w.value = v; };
    if (groups(T.look("A")).length) LOOKS(panel).forEach((w) => (w.value = isOn(T.look(LOOK_GROUP(w.name)))));
    pushStyle(panel);
    pushFlash(panel);
    pushNegative(panel);
    if (groups(T.people("A")).length) PEOPLE(panel).forEach((w) => (w.value = isOn(T.people(w.name.charAt(0)))));
    if (groups(T.polish).length) set("second pass", isOn(T.polish));
    set("steps", wid(T.steps(), "value")?.value);
    for (const [name, key] of Object.entries(SWITCHES)) {
        const w = wid(T[key](), "switch");
        if (!w) continue;
        set(name, !!w.value);
        if (!w._kPanelHooked) { // flipping the node itself updates the panel too
            const cb = w.callback;
            w.callback = function (v) { const r = cb?.apply(this, arguments); set(name, !!v); redraw(); return r; };
            w._kPanelHooked = true;
        }
    }
    redraw();
}

app.registerExtension({
    name: "Kreative2AI.ControlPanel",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "KreativeModelPanel") {
            const created = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                created?.apply(this, arguments);
                addHeading(this, "model", "MODEL");
                addHeading(this, "text encoder", "TEXT ENCODER");
                addHeading(this, "vae", "VAE");
                addHeading(this, "prompt writer", "PROMPT WRITER (the AI that writes your prompt)");
                addHeading(this, "lora 1", "LORAS  ·  None = off");
                this.setSize([Math.max(this.size[0], 480), this.computeSize()[1]]);
            };
            return;
        }
        if (nodeData.name !== "KreativeControlPanel") return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;
            for (const w of node.widgets || []) {
                const cb = w.callback;
                w.callback = function (v) { const r = cb?.apply(this, arguments); apply(node, w); return r; };
            }
            addHeading(node, "A · Clean (no look)", "LOOK  ·  switch ONE on");
            addHeading(node, "your own style", "YOUR OWN STYLE  ·  used when ✏️ is ON");
            addHeading(node, FLASH, "ADD-ON  ·  works with every look");
            addHeading(node, "A · Caucasian", "PEOPLE  ·  switch ONE on");
            const styleW = wid(node, "your own style");
            if (styleW) styleW.beforeQueued = () => { pushStyle(node); pushFlash(node); pushNegative(node); }; // always send the latest text
            addHeading(node, "steps", "QUALITY  ·  25 = quick, 50 = best");
            addHeading(node, "second pass", "EXTRAS  ·  ON or off\n⏳ Detail (SeedVR2) is slow the first time: it loads 3.19 GB");
            node.setSize([Math.max(node.size[0], 480), node.computeSize()[1]]);
            setTimeout(() => sync(node), 400);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTimeout(() => sync(this), 600);
        };
    },
});
