// "MY PROMPT" rows: the 1a row editor, adapted. Blank rows are kept (they are slots for your own prompts).
// No ComfyUI imports in here so the logic can be unit-tested in plain Node.

export const RADIO_MODE = "Single Active (Radio)";

export function isBlank(row) {
    return !String((row && row.text) || "").trim();
}

function cleanRow(r) {
    return { enabled: Boolean(r && r.enabled), text: String((r && r.text) || "") };
}

// Keeps only the first ON row (radio mode).
export function enforceRadio(rows) {
    let seen = false;
    return rows.map((r) => {
        if (r.enabled && !seen) {
            seen = true;
            return r;
        }
        return { ...r, enabled: false };
    });
}

// Drops the pile of empty rows at the end, leaving at most one empty row for a new idea.
// Never touches empty rows in the middle (their positions are the user's) and never drops an ON row.
export function trimTrailingBlanks(rows) {
    const out = rows.map(cleanRow);
    while (out.length > 1) {
        const last = out[out.length - 1];
        const prev = out[out.length - 2];
        if (isBlank(last) && !last.enabled && isBlank(prev) && !prev.enabled) out.pop();
        else break;
    }
    if (out.length === 0) out.push({ enabled: false, text: "" });
    return out;
}

export function normaliseRows(rows, radio) {
    let out = Array.isArray(rows) ? rows.map(cleanRow) : [];
    if (out.length === 0) out.push({ enabled: radio, text: "" });
    if (radio) out = enforceRadio(out);
    return out;
}

// Selecting a row: radio mode turns the others off, combine mode toggles this one.
export function selectRow(rows, idx, radio) {
    const out = rows.map(cleanRow);
    if (idx < 0 || idx >= out.length) return out;
    if (radio) out.forEach((r, i) => { r.enabled = i === idx; });
    else out[idx].enabled = !out[idx].enabled;
    return out;
}

// Which row "Remove Selected" acts on.
// Radio mode: the ON row. Combine mode: the row last clicked, else the last ON row.
export function pickRemoveIndex(rows, radio, lastTouched) {
    if (!rows.length) return -1;
    if (radio) return rows.findIndex((r) => r.enabled);
    if (Number.isInteger(lastTouched) && lastTouched >= 0 && lastTouched < rows.length) return lastTouched;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].enabled) return i;
    return -1;
}

// Removes a row. The last remaining row is cleared instead of deleted.
// In radio mode the next sensible idea becomes the selected one, so a run never starts with nothing selected.
export function removeRow(rows, idx, radio) {
    let out = rows.map(cleanRow);
    if (idx < 0 || idx >= out.length) return { rows: out, selected: -1 };
    if (out.length === 1) {
        return { rows: [{ enabled: radio ? true : false, text: "" }], selected: 0 };
    }
    out.splice(idx, 1);

    // candidate order: the row that slid into this spot, then back, then forward
    const order = [];
    for (let i = idx; i < out.length; i++) order.push(i);
    for (let i = idx - 1; i >= 0; i--) order.push(i);
    let cand = order.find((i) => i < out.length && !isBlank(out[i]));
    if (cand === undefined) cand = Math.min(idx, out.length - 1);

    if (radio) out.forEach((r, i) => { r.enabled = i === cand; });
    return { rows: out, selected: cand };
}

export function autoGrow(ta) {
    ta.style.height = "auto";
    const sh = ta.scrollHeight;
    if (sh > 0) {
        ta.style.height = `${sh + 2}px`;
    } else {
        // not attached yet (or no layout): estimate so it is never zero
        const lines = Math.max(8, Math.ceil((ta.value || "").length / 58));
        ta.style.height = `${lines * 19 + 10}px`;
    }
}

function styleButton(btn, bg, border) {
    Object.assign(btn.style, {
        background: bg,
        color: "#fff",
        border: `1px solid ${border}`,
        borderRadius: "4px",
        padding: "3px 8px",
        cursor: "pointer",
        fontSize: "11px",
        fontWeight: "bold",
    });
}

/**
 * Builds the node body.
 *  getRows()    -> rows (normalised)
 *  setRows(r)   -> persist
 *  getMode()    -> selection mode string
 *  onChange()   -> called after anything that may change the height
 * Returns { outer, inner, render, growAll }.
 *  outer is what ComfyUI sizes. inner holds the content and has its natural height.
 */
export function createPromptMultiUI({ doc, getRows, setRows, getMode, onChange }) {
    const outer = doc.createElement("div");
    Object.assign(outer.style, {
        width: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
    });

    const inner = doc.createElement("div");
    Object.assign(inner.style, {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "6px",
        background: "rgba(0,0,0,0.28)",
        borderRadius: "6px",
        border: "1px solid #3a4a3a",
        boxSizing: "border-box",
        width: "100%",
    });
    outer.appendChild(inner);

    let lastTouched = null;
    const undoStack = [];
    const isRadio = () => getMode() === RADIO_MODE;

    function snapshot(rows) {
        undoStack.push(rows.map(cleanRow));
        if (undoStack.length > 10) undoStack.shift();
    }

    function growAll() {
        inner.querySelectorAll("textarea").forEach((ta) => autoGrow(ta));
    }

    function render() {
        const rows = getRows();
        setRows(rows);
        inner.textContent = "";

        // --- header ------------------------------------------------------
        const header = doc.createElement("div");
        Object.assign(header.style, {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
            marginBottom: "4px",
        });
        const title = doc.createElement("span");
        title.textContent = `My prompts (${rows.filter((r) => r.enabled).length} ON)`;
        Object.assign(title.style, { fontSize: "12px", color: "#9fd89f", fontWeight: "bold" });

        const buttons = doc.createElement("div");
        Object.assign(buttons.style, { display: "flex", gap: "5px", alignItems: "center" });

        const addBtn = doc.createElement("button");
        addBtn.textContent = "+ Add prompt";
        styleButton(addBtn, "#2e6b3a", "#4a9e5c");
        addBtn.dataset.action = "add";
        addBtn.onclick = (e) => {
            e.preventDefault();
            const cur = getRows();
            cur.push({ enabled: false, text: "" });
            setRows(cur);
            render();
            const tas = inner.querySelectorAll("textarea");
            if (tas.length) tas[tas.length - 1].focus();
            onChange();
        };

        const removeBtn = doc.createElement("button");
        removeBtn.textContent = "− Remove prompt";
        styleButton(removeBtn, "#7a2e2e", "#b25252");
        removeBtn.title = isRadio()
            ? "Removes the prompt that is ON"
            : "Removes the prompt you last clicked";
        removeBtn.dataset.action = "remove";
        removeBtn.onclick = (e) => {
            e.preventDefault();
            const cur = getRows();
            const idx = pickRemoveIndex(cur, isRadio(), lastTouched);
            if (idx < 0) return;
            snapshot(cur);
            const res = removeRow(cur, idx, isRadio());
            lastTouched = res.selected;
            setRows(res.rows);
            render();
            onChange();
        };

        buttons.appendChild(addBtn);
        buttons.appendChild(removeBtn);

        if (undoStack.length) {
            const undoBtn = doc.createElement("button");
            undoBtn.textContent = `↶ Undo (${undoStack.length})`;
            styleButton(undoBtn, "#3a3a3a", "#666");
            undoBtn.dataset.action = "undo";
            undoBtn.onclick = (e) => {
                e.preventDefault();
                const prev = undoStack.pop();
                if (!prev) return;
                setRows(prev);
                render();
                onChange();
            };
            buttons.appendChild(undoBtn);
        }

        header.appendChild(title);
        header.appendChild(buttons);
        inner.appendChild(header);

        // --- rows ----------------------------------------------------------
        rows.forEach((row, idx) => {
            const rowEl = doc.createElement("div");
            rowEl.dataset.row = String(idx);
            Object.assign(rowEl.style, {
                display: "flex",
                gap: "6px",
                alignItems: "flex-start",
                padding: "5px",
                borderRadius: "5px",
                background: row.enabled ? "rgba(46, 107, 58, 0.38)" : "rgba(28, 28, 28, 0.65)",
                border: row.enabled ? "1px solid #58b86c" : "1px solid #444",
            });

            const toggleBtn = doc.createElement("button");
            toggleBtn.textContent = row.enabled ? "ON" : "OFF";
            toggleBtn.dataset.action = "toggle";
            Object.assign(toggleBtn.style, {
                minWidth: "46px",
                height: "28px",
                background: row.enabled ? "#2e8b47" : "#333",
                color: row.enabled ? "#fff" : "#999",
                border: row.enabled ? "1px solid #6be088" : "1px solid #555",
                borderRadius: "4px",
                fontWeight: "bold",
                fontSize: "11px",
                cursor: "pointer",
                marginTop: "2px",
                flex: "0 0 auto",
            });
            toggleBtn.onclick = (e) => {
                e.preventDefault();
                lastTouched = idx;
                setRows(selectRow(getRows(), idx, isRadio()));
                render();
                onChange();
            };

            const textArea = doc.createElement("textarea");
            textArea.value = row.text || "";
            textArea.rows = 8;
            textArea.placeholder = `Write prompt #${idx + 1}... (put LoRA trigger words first)`;
            Object.assign(textArea.style, {
                flex: "1",
                minWidth: "0",
                background: "#161616",
                color: row.enabled ? "#fff" : "#aaa",
                border: "1px solid #3c3c3c",
                borderRadius: "4px",
                padding: "4px 6px",
                fontSize: "13px",
                lineHeight: "1.45",
                resize: "none",
                overflow: "hidden",
                fontFamily: "sans-serif",
                boxSizing: "border-box",
            });
            textArea.oninput = (e) => {
                const cur = getRows();
                if (cur[idx]) cur[idx].text = e.target.value;
                setRows(cur);
                autoGrow(textArea);
                onChange();
            };
            textArea.onfocus = () => { lastTouched = idx; };

            const delBtn = doc.createElement("button");
            delBtn.textContent = "×";
            delBtn.title = "Delete this prompt";
            delBtn.dataset.action = "delete";
            Object.assign(delBtn.style, {
                background: "transparent",
                color: "#888",
                border: "none",
                cursor: "pointer",
                fontSize: "16px",
                padding: "0 4px",
                flex: "0 0 auto",
            });
            delBtn.onclick = (e) => {
                e.preventDefault();
                const cur = getRows();
                snapshot(cur);
                const res = removeRow(cur, idx, isRadio() && cur[idx] && cur[idx].enabled);
                lastTouched = res.selected;
                setRows(res.rows);
                render();
                onChange();
            };

            rowEl.appendChild(toggleBtn);
            rowEl.appendChild(textArea);
            rowEl.appendChild(delBtn);
            inner.appendChild(rowEl);
        });

        growAll();
    }

    return { outer, inner, render, growAll };
}
