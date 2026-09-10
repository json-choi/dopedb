"""Generate every DopeDB brand projection from the approved SVG, never redraw it.

The hook-free React graphic shares the same geometry as the app/web assets.
PNG/ICO/ICNS rendering uses the site's installed Sharp, Pillow and macOS iconutil.
All outputs are staged first; --check compares without changing repository files.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/brand/dopedb-icon.svg"
GRAPHIC = Path("src/design-system/components/DopeDBMarkGraphic.tsx")
SVG_OUTPUTS = (Path("site/public/favicon.svg"), Path("workspace-cloud/app/icon.svg"))
PNG_OUTPUTS = {
    "src-tauri/icons/icon.png": 1024,
    "src-tauri/icons/32x32.png": 32,
    "src-tauri/icons/128x128.png": 128,
    "src-tauri/icons/128x128@2x.png": 256,
    "site/public/favicon-48x48.png": 48,
    "site/public/apple-touch-icon.png": 180,
    "site/public/icon-192.png": 192,
    "site/public/icon-512.png": 512,
    "site/public/oauth-logo-120.png": 120,
    "workspace-cloud/app/apple-icon.png": 180,
}
ICO_OUTPUTS = {
    "src-tauri/icons/icon.ico": (16, 32, 48, 64, 128, 256),
    "site/public/favicon.ico": (16, 32, 48, 64),
    "workspace-cloud/app/favicon.ico": (16, 32, 48, 64),
}
ICNS_OUTPUT = Path("src-tauri/icons/icon.icns")


def render_graphic(svg: bytes) -> str:
    document = ElementTree.fromstring(svg)
    if document.attrib.get("viewBox") != "0 0 32 32":
        raise ValueError("The approved brand viewBox must remain 0 0 32 32")
    tile = next(child for child in document if child.attrib.get("id") == "tile")
    document.remove(tile)
    ids = {node.attrib["id"] for node in document.iter() if "id" in node.attrib}

    def attribute(name: str, value: str) -> str:
        prop = re.sub(r"-([a-z])", lambda match: match[1].upper(), name)
        if name == "id":
            return f'{prop}={{`${{prefix}}-{value}`}}'
        if name == "href" and value.startswith("#"):
            reference = value[1:]
            if reference not in ids:
                raise ValueError(f"Unknown SVG reference: {value}")
            return f'{prop}={{`#${{prefix}}-{reference}`}}'
        if value.startswith("url(#"):
            reference = value[5:-1]
            if reference not in ids:
                raise ValueError(f"Unknown SVG reference: {value}")
            return f'{prop}={{`url(#${{prefix}}-{reference})`}}'
        return f"{prop}={json.dumps(value)}"

    def element(node: ElementTree.Element, depth: int = 3) -> str:
        tag = node.tag.rsplit("}", 1)[-1]
        indent = "  " * depth
        props = " ".join(attribute(name, value) for name, value in node.attrib.items())
        opening = f"{indent}<{tag}" + (f" {props}" if props else "")
        if not len(node):
            return opening + " />"
        children = "\n".join(element(child, depth + 1) for child in node)
        return f"{opening}>\n{children}\n{indent}</{tag}>"

    geometry = "\n".join(element(child) for child in document)
    fingerprint = hashlib.sha256(svg).hexdigest()
    return f'''// Generated from assets/brand/dopedb-icon.svg by pnpm icons; do not edit.
// Hook-free shared SVG: each app passes its own React useId() for isolated masks.
// Mask black/white values encode opacity; visible artwork inherits currentColor.
// Source SHA-256: {fingerprint}
export function DopeDBMarkGraphic({{
  instanceId,
  className,
  size = 28,
}}: {{
  instanceId: string;
  className?: string;
  size?: number;
}}) {{
  const prefix = `dopedb-${{instanceId.replace(/:/g, "")}}`;
  return (
    <svg
      className={{className}}
      width={{size}}
      height={{size}}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-dopedb-mark="orbital"
    >
{geometry}
    </svg>
  );
}}
'''


def render_icon(svg: bytes) -> Image.Image:
    # Resolve Sharp from its declared Next dependency, without installing a second
    # rasterizer or depending on pnpm's private store path. SVG masks stay intact.
    script = '''
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const siteRequire = createRequire(resolve("site/package.json"));
const nextRequire = createRequire(siteRequire.resolve("next/package.json"));
const sharp = nextRequire("sharp");
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const png = await sharp(Buffer.concat(chunks), { density: 4608 })
  .resize(1024, 1024).png().toBuffer();
process.stdout.write(png);
'''
    result = subprocess.run(
        ["node", "--input-type=commonjs", "-e", f"(async () => {{ {script} }})().catch(error => {{ console.error(error); process.exitCode = 1; }});"],
        cwd=ROOT,
        input=svg,
        stdout=subprocess.PIPE,
        check=True,
    )
    with Image.open(io.BytesIO(result.stdout)) as image:
        return image.convert("RGBA")


def save_png(source: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    source.resize((size, size), Image.Resampling.LANCZOS).save(path)


def generate_icns(source: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="dopedb-", suffix=".iconset") as directory:
        iconset = Path(directory)
        for size in (16, 32, 128, 256, 512):
            save_png(source, iconset / f"icon_{size}x{size}.png", size)
            save_png(source, iconset / f"icon_{size}x{size}@2x.png", size * 2)
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(path)], check=True)


def generate_assets(staging: Path) -> list[Path]:
    svg = SOURCE.read_bytes()
    graphic = render_graphic(svg)
    source = render_icon(svg)
    for relative in SVG_OUTPUTS:
        path = staging / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(svg)
    graphic_path = staging / GRAPHIC
    graphic_path.parent.mkdir(parents=True, exist_ok=True)
    graphic_path.write_text(graphic, encoding="utf-8")
    for relative, size in PNG_OUTPUTS.items():
        save_png(source, staging / relative, size)
    for relative, sizes in ICO_OUTPUTS.items():
        path = staging / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        source.save(path, sizes=[(size, size) for size in sizes])
    generate_icns(source, staging / ICNS_OUTPUT)
    return [GRAPHIC, *SVG_OUTPUTS, *(Path(path) for path in PNG_OUTPUTS),
            *(Path(path) for path in ICO_OUTPUTS), ICNS_OUTPUT]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail on stale assets without modifying them")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="dopedb-icons-") as directory:
        staging = Path(directory)
        outputs = generate_assets(staging)
        stale = [relative for relative in outputs
                 if not (ROOT / relative).exists()
                 or (ROOT / relative).read_bytes() != (staging / relative).read_bytes()]
        if args.check:
            if stale:
                raise SystemExit("Stale DopeDB icons; run pnpm icons:\n" + "\n".join(map(str, stale)))
            print(f"DopeDB orbital brand: all {len(outputs)} generated files match the SVG source")
            return
        for relative in stale:
            target = ROOT / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(staging / relative, target)
        print(f"Generated DopeDB orbital brand: {len(stale)} updated, {len(outputs)} verified")


if __name__ == "__main__":
    main()
