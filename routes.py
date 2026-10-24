"""POST /kreative/keep : copy a previewed temp image into the output folder."""
import os
import shutil

from aiohttp import web
from PIL import Image

import folder_paths
from server import PromptServer


def _safe_prefix(prefix):
    prefix = (prefix or "moss-image-sft").replace("\\", "/")
    parts = [p for p in prefix.split("/") if p not in ("", ".", "..")]
    return "/".join(parts) or "moss-image-sft"


@PromptServer.instance.routes.post("/kreative/keep")
async def kreative_keep(request):
    try:
        data = await request.json()
        temp_dir = os.path.abspath(folder_paths.get_temp_directory())
        src = os.path.abspath(os.path.join(temp_dir, data.get("subfolder", "") or "",
                                           os.path.basename(data["filename"])))
        if os.path.commonpath([temp_dir, src]) != temp_dir or not os.path.isfile(src):
            return web.json_response({"ok": False, "error": "Image not found (was ComfyUI restarted?)"}, status=404)
        with Image.open(src) as im:
            w, h = im.size
        out_dir = folder_paths.get_output_directory()
        full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            _safe_prefix(data.get("prefix")), out_dir, w, h)
        os.makedirs(full_folder, exist_ok=True)
        fname = f"{name}_{counter:05}_.png"
        shutil.copy2(src, os.path.join(full_folder, fname))
        return web.json_response({"ok": True, "filename": fname, "subfolder": subfolder})
    except Exception as e:  # keep the UI calm, report the reason
        return web.json_response({"ok": False, "error": str(e)}, status=500)
