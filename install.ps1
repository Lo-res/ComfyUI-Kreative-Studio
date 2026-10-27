# Kreative Studio + Moss Film Looks - one-command installer for Windows
# NOT TESTED YET - please report problems as an Issue on GitHub.
#
# Use (PowerShell, from your ComfyUI folder or anywhere):
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Lo-res/ComfyUI-Kreative-Studio/main/install.ps1 | iex"
#
# What it does:
#   1. finds your ComfyUI folder (or asks for it)
#   2. downloads Lo's 3 packs + the 7 other packs the workflow needs (skips any you already have)
#   3. installs their Python packages with ComfyUI's own Python
#   4. copies the Moss Film Looks v8 workflow into your workflows folder
# It does NOT download the models - see section 3 of the README for those.

$ErrorActionPreference = "Stop"

$Packs = @(
    @{ Name = "ComfyUI-Kreative-Studio";       Repo = "Lo-res/ComfyUI-Kreative-Studio" },
    @{ Name = "ComfyUI-Kreative-Moss";         Repo = "Lo-res/ComfyUI-Kreative-Moss" },
    @{ Name = "comfyui_aerochrome";            Repo = "Lo-res/comfyui_aerochrome" },
    @{ Name = "rgthree-comfy";                 Repo = "rgthree/rgthree-comfy" },
    @{ Name = "ComfyUI-Impact-Pack";           Repo = "ltdrdata/ComfyUI-Impact-Pack" },
    @{ Name = "ComfyUI-Impact-Subpack";        Repo = "ltdrdata/ComfyUI-Impact-Subpack" },
    @{ Name = "ComfyUI-SeedVR2_VideoUpscaler"; Repo = "numz/ComfyUI-SeedVR2_VideoUpscaler" },
    @{ Name = "comfyui-propost";               Repo = "digitaljohn/comfyui-propost" },
    @{ Name = "ComfyUI_essentials";            Repo = "cubiq/ComfyUI_essentials" }
)
$Workflow = "moss-image-sft_v8.json"

function Say($msg, $colour = "White") { Write-Host $msg -ForegroundColor $colour }

Say ""
Say "=== Kreative Studio + Moss Film Looks installer (Windows) ===" Cyan
Say "This installer is NEW and NOT TESTED YET. If anything goes wrong, follow the manual steps in the README." Yellow
Say ""

# ---- 1. find ComfyUI --------------------------------------------------------
function Test-Comfy($p) { return ($p -and (Test-Path (Join-Path $p "main.py")) -and (Test-Path (Join-Path $p "custom_nodes"))) }

$Comfy = $env:KREATIVE_COMFYUI
if (-not (Test-Comfy $Comfy)) {
    $here = (Get-Location).Path
    foreach ($c in @($here, (Join-Path $here "ComfyUI"), (Split-Path $here -Parent))) {
        if (Test-Comfy $c) { $Comfy = $c; break }
    }
}
while (-not (Test-Comfy $Comfy)) {
    $Comfy = Read-Host "Paste the full path to your ComfyUI folder (the one that contains main.py)"
    $Comfy = $Comfy.Trim('"', ' ')
    if (-not (Test-Comfy $Comfy)) { Say "  That folder has no main.py / custom_nodes. Try again." Red }
}
$Comfy = (Resolve-Path $Comfy).Path
$Nodes = Join-Path $Comfy "custom_nodes"
Say "ComfyUI folder: $Comfy" Green

# ---- ComfyUI's own Python --------------------------------------------------
$Python = $null
foreach ($c in @(
    (Join-Path (Split-Path $Comfy -Parent) "python_embeded\python.exe"),
    (Join-Path $Comfy "..\python_embedded\python.exe"),
    (Join-Path $Comfy "venv\Scripts\python.exe"),
    (Join-Path $Comfy ".venv\Scripts\python.exe"))) {
    if (Test-Path $c) { $Python = (Resolve-Path $c).Path; break }
}
if (-not $Python) {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) {
        $Python = $cmd.Source
        Say "Could not find ComfyUI's own Python, so using: $Python" Yellow
        Say "  If ComfyUI uses a different Python, install the packages yourself afterwards (see README)." Yellow
    } else {
        Say "No Python found. The packs will be downloaded, but their Python packages will NOT be installed." Yellow
    }
} else {
    Say "Python: $Python" Green
}

$HasGit = [bool](Get-Command git -ErrorAction SilentlyContinue)
Say ("Download method: " + $(if ($HasGit) { "git" } else { "ZIP (git not found)" })) Green
Say ""

# ---- 2. packs ---------------------------------------------------------------
$Tmp = Join-Path $env:TEMP ("kreative_install_" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $Tmp | Out-Null
$Failed = @()

foreach ($p in $Packs) {
    $dest = Join-Path $Nodes $p.Name
    if (Test-Path $dest) { Say ("[skip] " + $p.Name + " is already installed") DarkGray; continue }
    Say ("[get ] " + $p.Name) White
    try {
        if ($HasGit) {
            git clone --depth 1 ("https://github.com/" + $p.Repo + ".git") $dest 2>&1 | Out-Null
            if (-not (Test-Path $dest)) { throw "git clone failed" }
        } else {
            $zip = Join-Path $Tmp ($p.Name + ".zip")
            Invoke-WebRequest -UseBasicParsing -Uri ("https://github.com/" + $p.Repo + "/archive/HEAD.zip") -OutFile $zip
            $out = Join-Path $Tmp $p.Name
            Expand-Archive -Path $zip -DestinationPath $out -Force
            $inner = Get-ChildItem $out -Directory | Select-Object -First 1
            Move-Item $inner.FullName $dest
        }
    } catch {
        Say ("  FAILED: " + $p.Name + " - " + $_.Exception.Message) Red
        $Failed += $p.Name
        continue
    }
    # ---- 3. Python packages ----
    $req = Join-Path $dest "requirements.txt"
    if ($Python -and (Test-Path $req)) {
        Say ("       installing Python packages for " + $p.Name + " ...") DarkGray
        & $Python -m pip install -r $req --disable-pip-version-check
        if ($LASTEXITCODE -ne 0) { Say ("  pip reported a problem for " + $p.Name) Yellow; $Failed += ($p.Name + " (packages)") }
    }
}

# ---- 4. workflow ------------------------------------------------------------
$wfSrc = Join-Path $Nodes ("ComfyUI-Kreative-Studio\workflows\" + $Workflow)
$wfDir = Join-Path $Comfy "user\default\workflows"
if (Test-Path $wfSrc) {
    New-Item -ItemType Directory -Force -Path $wfDir | Out-Null
    $wfDest = Join-Path $wfDir $Workflow
    if (Test-Path $wfDest) {
        Say "[skip] the workflow is already in your workflows folder (left as it is)" DarkGray
    } else {
        Copy-Item $wfSrc $wfDest
        Say "[ ok ] workflow copied to $wfDir" Green
    }
}

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue

Say ""
if ($Failed.Count) {
    Say ("Finished with problems: " + ($Failed -join ", ")) Yellow
    Say "Install those by hand - see section 2 of the README." Yellow
} else {
    Say "All done." Green
}
Say "Next:" Cyan
Say "  1. Download the models - README section 3 (about 20 GB)." White
Say "  2. Restart ComfyUI and refresh your browser (Ctrl + F5)." White
Say "  3. Open 'moss-image-sft_v8' from the Workflows sidebar." White
Say ""
