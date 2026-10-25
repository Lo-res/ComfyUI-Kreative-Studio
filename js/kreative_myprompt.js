import { app } from "../../scripts/app.js";
import { createPromptMultiUI, normaliseRows, RADIO_MODE } from "./lib/myprompt_rows_ui.js";

// MY PROMPT: your own prompts, with a switch that turns the AI prompt writer off.
// OFF mutes the prompt-writer nodes inside the Moss engine, so the writer does not run at all.

const WRITER = "AI prompt writer";
const LOOK_TEXT = "add look + lens text";
const DEFAULT_ROWS = [{ enabled: true, text: "" }, { enabled: false, text: "" }, { enabled: false, text: "" }];
const MIN_WIDTH = 480;

// Nodes that only exist to write the prompt (matched by the start of their title).
const WRITER_NODES = [
    "Prompt-writer instructions",
    "Prompt writer (AI)",
    "Wrap idea (start tag)",
    "Wrap idea (end tag",
    "Safety net 1",
    "Safety net 2",
    "Use colour-stripped text",
];

const graphs = () => {
    const out = [app.graph];
    const subs = app.graph?.subgraphs;
    if (subs) for (const s of subs.values()) out.push(s);
    return out.filter(Boolean);
};
const nodesOf = (g) => g._nodes || g.nodes || [];

function applyWriter(on) {
    for (const g of graphs())
        for (const n of nodesOf(g))
            if (WRITER_NODES.some((t) => (n.title || "").startsWith(t))) n.mode = on ? 0 : 2;
    app.graph?.setDirtyCanvas(true, true);
}

app.registerExtension({
    name: "Kreative2AI.MyPrompt",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "KreativeMyPrompt") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;
            const wid = (name) => node.widgets?.find((w) => w.name === name);
            const dataWidget = wid("prompt_data");
            const modeWidget = wid("selection_mode");
            const writerWidget = wid(WRITER);
            if (!dataWidget) return;

            dataWidget.computeSize = () => [0, -4];
            const hideRawInput = () => {
                if (dataWidget.inputEl) dataWidget.inputEl.style.display = "none";
                if (dataWidget.element) dataWidget.element.style.display = "none";
            };
            hideRawInput();

            const isRadio = () => !modeWidget || modeWidget.value === RADIO_MODE;
            const readRows = () => {
                hideRawInput();
                let rows = null;
                try {
                    if (dataWidget.value && dataWidget.value.trim().startsWith("[")) {
                        const parsed = JSON.parse(dataWidget.value);
                        if (Array.isArray(parsed) && parsed.length > 0) rows = parsed;
                    }
                } catch (e) { /* use defaults */ }
                if (!rows) rows = JSON.parse(JSON.stringify(DEFAULT_ROWS));
                return normaliseRows(rows, isRadio());
            };
            const writeRows = (rows) => {
                dataWidget.value = JSON.stringify(rows);
                app.graph?.setDirtyCanvas(true, true);
            };

            let contentH = 260;
            const widgetHeight = () => contentH + 4;
            let fitting = false;
            const fit = () => {
                if (fitting) return;
                const top = domWidget.y ?? domWidget.last_y;
                const newH = typeof top === "number" && top > 0 ? top + widgetHeight() + 10 : node.size[1];
                if (Math.abs(newH - node.size[1]) > 1) {
                    fitting = true;
                    node.setSize([Math.max(node.size[0], MIN_WIDTH), newH]);
                    fitting = false;
                    app.graph?.setDirtyCanvas(true, true);
                }
            };

            const ui = createPromptMultiUI({
                doc: document,
                getRows: readRows,
                setRows: writeRows,
                getMode: () => (modeWidget ? modeWidget.value : RADIO_MODE),
                onChange: () => requestAnimationFrame(() => measure()),
            });
            const measure = () => {
                const h = Math.ceil(ui.inner.offsetHeight);
                if (h > 0 && h !== contentH) { contentH = h; fit(); }
            };
            // Rows look dimmed while the AI writer is ON (they are not used then).
            const dim = () => { ui.outer.style.opacity = writerWidget && writerWidget.value ? "0.45" : "1"; };

            const domWidget = node.addDOMWidget("kreative_myprompt_ui", "div", ui.outer, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => widgetHeight(),
                getMaxHeight: () => widgetHeight(),
                getHeight: () => widgetHeight(),
            });
            domWidget.computeSize = (width) => [width, widgetHeight()];
            domWidget.computeLayoutSize = () => ({ minHeight: widgetHeight(), maxHeight: widgetHeight(), minWidth: 300 });

            if (typeof ResizeObserver !== "undefined") {
                let lastW = 0;
                const ro = new ResizeObserver(() => {
                    const w = ui.inner.offsetWidth;
                    if (w && w !== lastW) { lastW = w; ui.growAll(); }
                    measure();
                });
                ro.observe(ui.inner);
                const onRemoved = node.onRemoved;
                node.onRemoved = function () { ro.disconnect(); onRemoved?.apply(this, arguments); };
            }
            const onResize = node.onResize;
            node.onResize = function () { onResize?.apply(this, arguments); requestAnimationFrame(() => fit()); };

            if (modeWidget) {
                const cb = modeWidget.callback;
                modeWidget.callback = function () { const r = cb?.apply(this, arguments); ui.render(); return r; };
            }
            if (writerWidget) {
                const cb = writerWidget.callback;
                writerWidget.callback = function (v) {
                    const r = cb?.apply(this, arguments);
                    applyWriter(!!writerWidget.value);
                    dim();
                    return r;
                };
            }

            node._kreativeSync = () => {
                ui.render();
                dim();
                if (writerWidget) applyWriter(!!writerWidget.value);
                requestAnimationFrame(() => measure());
            };
            setTimeout(() => node._kreativeSync(), 60);
            if (node.size[0] < MIN_WIDTH) node.setSize([MIN_WIDTH, node.size[1]]);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            if (this._kreativeSync) setTimeout(() => this._kreativeSync(), 700);
        };
    },
});
