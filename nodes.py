"""Kreative Studio nodes: seed control, on/off switch, detail mix, JPEG crunch, keep-or-bin output."""
import io
import random

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

import folder_paths
import nodes as comfy_nodes

MAX_SEED = 4294967295  # SeedVR2 accepts up to 2^32-1, so one seed fits every node
CAT = "Kreative/Studio"


class KreativeSeed:
    """A big, readable seed. Buttons (-1, +1, New, Previous) are added by js/kreative_seed.js."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed_number": ("INT", {"default": 123456, "min": 0, "max": MAX_SEED,
                                        "tooltip": "Same seed + same settings = same picture."}),
                "each_run": (["Keep this seed", "New seed each run"],
                             {"default": "Keep this seed",
                              "tooltip": "Keep = lock the seed. New = a fresh seed every time you press Run."}),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("seed",)
    FUNCTION = "go"
    CATEGORY = CAT

    def go(self, seed_number, each_run):
        return (int(seed_number),)


class KreativeImageOnOff:
    """On/off switch for an optional step. When OFF the step is never run (lazy input)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "switch": ("BOOLEAN", {"default": False, "label_on": "ON", "label_off": "OFF"}),
                "image_off": ("IMAGE", {"tooltip": "Image used when the switch is OFF"}),
            },
            "optional": {
                "image_on": ("IMAGE", {"lazy": True, "tooltip": "Result of the optional step"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "go"
    CATEGORY = CAT

    def check_lazy_status(self, switch, image_off=None, image_on=None):
        return ["image_on"] if switch and image_on is None else []

    def go(self, switch, image_off, image_on=None):
        if switch and image_on is not None:
            return (image_on,)
        return (image_off,)


def _resize_to(img, h, w):
    if img.shape[1] == h and img.shape[2] == w:
        return img
    x = img.movedim(-1, 1)
    x = F.interpolate(x, size=(h, w), mode="bicubic", align_corners=False, antialias=True)
    return x.movedim(1, -1).clamp(0, 1)


class KreativeDetailMix:
    """SeedVR2 on/off + 'detail mix'. 0 = original grit, 1 = full SeedVR2 clean-up."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "switch": ("BOOLEAN", {"default": False, "label_on": "ON", "label_off": "OFF"}),
                "original": ("IMAGE",),
                "detail_mix": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05,
                                         "tooltip": "0 = keep the original look, 1 = full SeedVR2. 0.4-0.6 keeps the grit."}),
            },
            "optional": {
                "detailed": ("IMAGE", {"lazy": True, "tooltip": "SeedVR2 output"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "go"
    CATEGORY = CAT

    def check_lazy_status(self, switch, original=None, detail_mix=0.5, detailed=None):
        return ["detailed"] if switch and detailed is None else []

    def go(self, switch, original, detail_mix, detailed=None):
        if not switch or detailed is None:
            return (original,)
        det = detailed[..., :3]
        orig = _resize_to(original[..., :3].to(det.device, det.dtype), det.shape[1], det.shape[2])
        if orig.shape[0] != det.shape[0]:
            orig = orig[:1].expand(det.shape[0], -1, -1, -1)
        out = orig * (1.0 - detail_mix) + det * detail_mix
        return (out.clamp(0, 1),)


def _jpeg_once(pil, quality, subsampling):
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=int(quality), subsampling=subsampling, optimize=False)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


class KreativeJPEGCrunch:
    """Phone-style JPEG compression. Switch on for any look; always on for the iPhone look."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "switch": ("BOOLEAN", {"default": False, "label_on": "ON", "label_off": "OFF",
                                       "tooltip": "Add JPEG crunch to any look"}),
                "quality": ("INT", {"default": 55, "min": 5, "max": 95, "step": 1,
                                    "tooltip": "Lower = more blocky. 40-60 looks like a phone."}),
                "passes": ("INT", {"default": 2, "min": 1, "max": 5, "step": 1,
                                   "tooltip": "Re-save several times, like an image shared again and again"}),
                "phone_softness": ("FLOAT", {"default": 0.85, "min": 0.5, "max": 1.0, "step": 0.05,
                                             "tooltip": "Shrink then grow back before saving. 1 = off."}),
                "always_on_for_iphone": ("BOOLEAN", {"default": True, "label_on": "YES", "label_off": "NO"}),
                "iphone_quality": ("INT", {"default": 45, "min": 5, "max": 95, "step": 1}),
            },
            "optional": {
                "look_text": ("STRING", {"forceInput": True,
                                         "tooltip": "The look prefix. If it mentions iPhone, crunch runs automatically."}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "go"
    CATEGORY = CAT

    def go(self, image, switch, quality, passes, phone_softness, always_on_for_iphone, iphone_quality, look_text=None):
        is_iphone = bool(always_on_for_iphone and look_text and "iphone" in look_text.lower())
        if not (switch or is_iphone):
            return (image,)
        q = quality if switch else iphone_quality
        out = []
        for frame in image:
            arr = (frame[..., :3].clamp(0, 1).cpu().numpy() * 255.0).round().astype(np.uint8)
            pil = Image.fromarray(arr)
            w, h = pil.size
            if phone_softness < 0.999:
                sw, sh = max(8, int(w * phone_softness)), max(8, int(h * phone_softness))
                pil = pil.resize((sw, sh), Image.BILINEAR).resize((w, h), Image.BILINEAR)
            for i in range(int(passes)):
                pil = _jpeg_once(pil, max(5, q - 3 * i), 2)  # 4:2:0 chroma like a phone
            out.append(torch.from_numpy(np.asarray(pil).astype(np.float32) / 255.0))
        return (torch.stack(out).to(image.device),)


class KreativeKeep(comfy_nodes.SaveImage):
    """Shows the result. Nothing is saved until you press KEEP (or switch auto_save on)."""

    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_kreative_" + "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5))
        self.compress_level = 1

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "moss-image-sft",
                                               "tooltip": "Name used when you press KEEP"}),
                "auto_save": ("BOOLEAN", {"default": False, "label_on": "Save every image",
                                          "label_off": "Only when I press KEEP"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "keep"
    OUTPUT_NODE = True
    CATEGORY = CAT

    def keep(self, images, filename_prefix="moss-image-sft", auto_save=False, prompt=None, extra_pnginfo=None):
        result = self.save_images(images, "kreative_preview", prompt, extra_pnginfo)
        saved = []
        if auto_save:
            saver = comfy_nodes.SaveImage()
            saved = saver.save_images(images, filename_prefix, prompt, extra_pnginfo)["ui"]["images"]
        result["ui"]["kreative_keep"] = [{"prefix": filename_prefix, "auto_saved": bool(auto_save),
                                          "saved": saved}]
        return result


def _ramp(x, a, b):
    return np.clip((x - a) / (b - a), 0.0, 1.0)


def _rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    safe = np.where(d == 0, 1.0, d)
    h = np.where(mx == r, ((g - b) / safe) % 6, np.where(mx == g, (b - r) / safe + 2, (r - g) / safe + 4)) * 60.0
    h = np.where(d == 0, 0.0, h)
    s = np.where(mx == 0, 0.0, d / np.where(mx == 0, 1.0, mx))
    return h, s, mx


def _hsv_to_rgb(h, s, v):
    c = v * s
    hp = (h % 360.0) / 60.0
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(c)
    i = np.floor(hp).astype(np.int32) % 6
    r = np.choose(i, [c, x, z, z, x, c])
    g = np.choose(i, [x, c, c, x, z, z])
    b = np.choose(i, [z, z, x, c, c, x])
    return np.stack([r, g, b], -1) + (v - c)[..., None]


# Each preset: (hue band start-fade, start-full, end-full, end-fade, target hue or "violet", saturation boost)
SWAP_PRESETS = {
    "LomoChrome Purple": [
        ((48, 68, 148, 162), "violet", 1.05),   # yellow-green .. green  -> violet / deep purple
        ((185, 200, 245, 260), 176.0, 1.0),     # blue                   -> teal
        ((30, 42, 48, 68), 328.0, 1.0),         # yellow                 -> pink
    ],
}


def colour_swap(rgb, preset="LomoChrome Purple", strength=1.0):
    """rgb: float array (..., 3) in 0-1. Shifts whole hue bands like a false-colour film.
    Greys, whites and skin are left alone (low saturation and skin hues are outside every band)."""
    h, s, v = _rgb_to_hsv(rgb)
    sat_gate = _ramp(s, 0.06, 0.20)
    # Clouds, haze and highlights: bright and only faintly coloured. Leave them alone so they stay white.
    pale_guard = 1.0 - _ramp(v, 0.68, 0.82) * (1.0 - _ramp(s, 0.22, 0.38))
    sat_gate = sat_gate * pale_guard
    out = rgb.copy()
    for (a, b, c, d), target, sboost in SWAP_PRESETS[preset]:
        w = _ramp(h, a, b) * (1 - _ramp(h, c, d)) * sat_gate * strength
        t = 278.0 + 12.0 * (1 - v) if target == "violet" else np.full_like(h, target)
        swapped = _hsv_to_rgb(t, np.clip(s * sboost, 0, 1), v)
        out = out * (1 - w[..., None]) + swapped * w[..., None]
    return np.clip(out, 0.0, 1.0)


class KreativeColourSwap:
    """False-colour film look applied to the finished picture, like the film's own chemistry:
    LomoChrome Purple turns every green violet, blue to teal and yellow to pink. Skin, whites and greys stay put."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",),
            "preset": (list(SWAP_PRESETS), {"default": "LomoChrome Purple"}),
            "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05,
                                   "tooltip": "1 = full colour swap, 0 = off."}),
        }}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "swap"
    CATEGORY = CAT

    def swap(self, image, preset, strength):
        if strength <= 0:
            return (image,)
        arr = image.detach().cpu().numpy().astype(np.float32)
        out = colour_swap(arr, preset, float(strength))
        return (torch.from_numpy(out).to(image.device, image.dtype),)


OWN_STYLE = "✏️ Your own style (type it below)"
VELVIA = ("A Fujifilm Velvia 50 slide photograph. Shot on Fujifilm Velvia 50 colour reversal film: "
          "ultra-saturated colours, deep blue skies, vivid greens and reds, rich contrast with deep shadows, "
          "warm golden highlights, very fine grain, crisp sharp detail.")
PANEL_LOOKS = ["A · Clean (no look)", OWN_STYLE, "B · 1970s Kodachrome", "C · Cheap iPhone",
               "D · Aerochrome (prompt)", "E · Aerochrome IR  🧪 EXPERIMENTAL",
               "G · Kodak Portra 400 (colour negative)", "H · Kodak Tri-X 400 (black & white)", "I · CineStill 800T (tungsten, night)", "J · Polaroid (soft, no sharpening)",
               "K · LomoChrome Purple (purple foliage)"]
FLASH = "📸 camera flash (any look)"
PANEL_PEOPLE = ["A · Caucasian", "B · Asian", "C · As in my idea", "D · No people"]


def _switch(on="ON", off="off", tip="", default=False):
    return ("BOOLEAN", {"default": default, "label_on": on, "label_off": off, "tooltip": tip})


class KreativeControlPanel:
    """One panel for the whole workflow. js/kreative_panel.js applies each switch to the real
    nodes and groups. Looks and people work like radio buttons: switching one ON switches the
    others OFF. It has no outputs, so it never runs on the server."""

    @classmethod
    def INPUT_TYPES(cls):
        req = {}
        for i, name in enumerate(PANEL_LOOKS):
            req[name] = _switch(tip="Look: switch ONE on.", default=(i == 0))
        req["your own style"] = ("STRING", {"multiline": True, "default": VELVIA,
            "tooltip": "Used when ✏️ Your own style is ON. Start with one short sentence naming the film or camera, "
                       "then describe the colours, grain and light."})
        req[FLASH] = _switch("ON · flash on every look", tip="Adds a direct on-camera flash to whichever look is on.")
        for i, name in enumerate(PANEL_PEOPLE):
            req[name] = _switch(tip="People: switch ONE on.", default=(i == 2))
        req["steps"] = ("INT", {"default": 50, "min": 4, "max": 100, "step": 1,
                                "tooltip": "Quality. 25 = quick test, 50 = best (slower)."})
        req["second pass"] = _switch("ON · finer polish, slower", tip="A second, finer pass.")
        req["face fix"] = _switch("ON · fixes small faces", tip="Finds faces and redraws them bigger.")
        req["detail (SeedVR2)"] = _switch("ON · ⏳ 1st run slow: loads 3.19 GB",
                                          tip="Sharper fine detail. The first run loads a 3.19 GB model, so it is slow.")
        req["JPEG crunch"] = _switch("ON · phone compression", "off (always on for iPhone)",
                                     tip="Phone-style compression. Always on for the iPhone look.")
        return {"required": req}

    RETURN_TYPES = ()
    FUNCTION = "go"
    CATEGORY = CAT

    def go(self, **kwargs):
        return ()


_CACHE = {}


def _cached(key, loader):
    if key not in _CACHE:
        _CACHE[key] = loader()
    return _CACHE[key]


class KreativeModelPanel:
    """Model, text encoder, VAE, prompt writer and up to 4 LoRAs in one block.
    Only the part you change is reloaded."""

    @classmethod
    def INPUT_TYPES(cls):
        unet = comfy_nodes.UNETLoader.INPUT_TYPES()["required"]
        clip = comfy_nodes.CLIPLoader.INPUT_TYPES()["required"]
        vae = comfy_nodes.VAELoader.INPUT_TYPES()["required"]
        loras = ["None"] + folder_paths.get_filename_list("loras")
        req = {
            "model": unet["unet_name"],
            "model weights": (["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],),
            "text encoder": clip["clip_name"],
            "text encoder type": (clip["type"][0], {"default": "moss_image"}),
            "vae": vae["vae_name"],
            "prompt writer": clip["clip_name"],
            "prompt writer type": (clip["type"][0], {"default": "qwen_image"}),
        }
        for i in range(1, 5):
            req[f"lora {i}"] = (loras, {"default": "None", "tooltip": "None = off"})
            req[f"lora {i} strength"] = ("FLOAT", {"default": 1.0, "min": -4.0, "max": 4.0, "step": 0.05})
        return {"required": req}

    RETURN_TYPES = ("MODEL", "CLIP", "VAE", "CLIP")
    RETURN_NAMES = ("model", "text_encoder", "vae", "prompt_writer")
    FUNCTION = "load"
    CATEGORY = CAT

    def load(self, **kw):
        mk = ("unet", kw["model"], kw["model weights"])
        ck = ("clip", kw["text encoder"], kw["text encoder type"])
        vk = ("vae", kw["vae"])
        pk = ("pw", kw["prompt writer"], kw["prompt writer type"])
        for key in (mk, ck, vk, pk):  # drop old files of the same kind, keep the rest
            for old in [k for k in _CACHE if k[0] == key[0] and k != key]:
                _CACHE.pop(old)
        model = _cached(mk, lambda: comfy_nodes.UNETLoader().load_unet(kw["model"], kw["model weights"])[0])
        clip = _cached(ck, lambda: comfy_nodes.CLIPLoader().load_clip(kw["text encoder"], kw["text encoder type"])[0])
        vae = _cached(vk, lambda: comfy_nodes.VAELoader().load_vae(kw["vae"])[0])
        pw = _cached(pk, lambda: comfy_nodes.CLIPLoader().load_clip(kw["prompt writer"], kw["prompt writer type"])[0])
        lora = comfy_nodes.LoraLoaderModelOnly()
        for i in range(1, 5):
            name, strength = kw[f"lora {i}"], kw[f"lora {i} strength"]
            if name and name != "None" and strength != 0:
                model = lora.load_lora_model_only(model, name, strength)[0]
        return (model, clip, vae, pw)


NODE_CLASS_MAPPINGS = {
    "KreativeControlPanel": KreativeControlPanel,
    "KreativeModelPanel": KreativeModelPanel,
    "KreativeSeed": KreativeSeed,
    "KreativeImageOnOff": KreativeImageOnOff,
    "KreativeDetailMix": KreativeDetailMix,
    "KreativeJPEGCrunch": KreativeJPEGCrunch,
    "KreativeKeep": KreativeKeep,
    "KreativeColourSwap": KreativeColourSwap,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KreativeControlPanel": "Kreative Control Panel (looks, people, extras)",
    "KreativeModelPanel": "Kreative Model Panel (model, text encoder, VAE, prompt writer, LoRAs)",
    "KreativeSeed": "Kreative Seed (lock / +1 / -1 / new)",
    "KreativeImageOnOff": "Kreative On / Off (skips the step when off)",
    "KreativeDetailMix": "Kreative Detail Mix (SeedVR2 on / off)",
    "KreativeJPEGCrunch": "Kreative JPEG Crunch",
    "KreativeKeep": "Kreative Result (Keep or Bin)",
    "KreativeColourSwap": "Kreative Colour Swap (false-colour film)",
}
