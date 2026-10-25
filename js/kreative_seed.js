import { app } from "../../scripts/app.js";

// Big, simple seed control: -1 / +1 / New / Previous, plus "new each run".
const NEW_EACH_RUN = "New seed each run";
const MAX_SEED = 4294967295; // same limit as the node (SeedVR2 accepts up to 2^32 - 1)
const randomSeed = () => Math.floor(Math.random() * (MAX_SEED + 1)); // any seed from 0 to 4,294,967,295

export function seedApi(node) {
    const seedW = node.widgets?.find((w) => w.name === "seed_number");
    const modeW = node.widgets?.find((w) => w.name === "each_run");
    node._kHistory = node._kHistory || [];
    const refresh = () => {
        const prev = node._kHistory[node._kHistory.length - 1];
        if (node._kPrevBtn) node._kPrevBtn.name = prev === undefined ? "↩ Previous seed (none yet)" : `↩ Previous seed: ${prev}`;
        app.graph?.setDirtyCanvas(true, true);
        node._kOnSeedChange?.();
    };
    const set = (v, remember = true) => {
        if (!seedW) return;
        v = Math.max(0, Math.min(MAX_SEED, Math.round(Number(v) || 0)));
        if (remember && v !== seedW.value) {
            node._kHistory.push(seedW.value);
            if (node._kHistory.length > 20) node._kHistory.shift();
        }
        seedW.value = v;
        seedW.callback?.(v);
        refresh();
    };
    return {
        get: () => seedW?.value,
        set,
        up: () => set(seedW.value + 1),
        down: () => set(seedW.value - 1),
        random: () => set(randomSeed()),
        previous: () => {
            if (!node._kHistory.length) return;
            set(node._kHistory.pop(), false);
        },
        isLocked: () => modeW?.value !== NEW_EACH_RUN,
        setLocked: (locked) => {
            if (!modeW) return;
            modeW.value = locked ? "Keep this seed" : NEW_EACH_RUN;
            modeW.callback?.(modeW.value);
            refresh();
        },
        refresh,
        seedW,
    };
}

app.registerExtension({
    name: "Kreative2AI.Seed",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "KreativeSeed") return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;
            const s = seedApi(node);
            const opt = { serialize: false };
            node.addWidget("button", "➖  1   (seed down)", null, () => s.down(), opt);
            node.addWidget("button", "➕  1   (seed up)", null, () => s.up(), opt);
            node.addWidget("button", "🎲  New seed", null, () => s.random(), opt);
            node._kPrevBtn = node.addWidget("button", "↩ Previous seed (none yet)", null, () => s.previous(), opt);
            // Runs just before the job is sent, so the image metadata holds the seed really used.
            if (s.seedW) {
                s.seedW.beforeQueued = () => {
                    if (!s.isLocked()) s.random();
                };
            }
            node.setSize([Math.max(node.size[0], 420), node.computeSize()[1]]);
        };
    },
});
