import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// KEEP / BIN buttons for the Kreative Result node.
export async function keepImages(images, prefix) {
    const saved = [];
    for (const im of images || []) {
        const r = await api.fetchApi("/kreative/keep", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: im.filename, subfolder: im.subfolder, prefix }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Save failed");
        saved.push(j.filename);
    }
    return saved;
}

app.registerExtension({
    name: "Kreative2AI.Keep",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "KreativeKeep") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;
            const opt = { serialize: false };
            const prefixW = () => node.widgets.find((w) => w.name === "filename_prefix");
            node._kStatus = node.addWidget("button", "Nothing made yet", null, () => {}, opt);
            node._kKeepBtn = node.addWidget("button", "💾  KEEP this image", null, async () => {
                if (!node._kLast?.length) return;
                if (node._kKept) { node._kStatus.name = "Already kept ✓"; app.graph.setDirtyCanvas(true); return; }
                node._kStatus.name = "Saving…";
                try {
                    const names = await keepImages(node._kLast, prefixW()?.value);
                    node._kKept = true;
                    node._kStatus.name = `Kept ✓  ${names.join(", ")}`;
                } catch (e) {
                    node._kStatus.name = `Not saved: ${e.message}`;
                }
                app.graph.setDirtyCanvas(true);
            }, opt);
            node.addWidget("button", "🗑  BIN it (don't save)", null, () => {
                node._kLast = [];
                node.imgs = [];
                node._kStatus.name = "Binned - not saved";
                app.graph.setDirtyCanvas(true, true);
            }, opt);
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            this._kLast = message?.images || [];
            const info = message?.kreative_keep?.[0];
            this._kKept = !!info?.auto_saved;
            if (this._kStatus) {
                this._kStatus.name = info?.auto_saved ? "Auto-saved ✓" : "Not saved yet - press KEEP";
            }
            app.graph.setDirtyCanvas(true);
        };
    },
});
