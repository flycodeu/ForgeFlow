"""Regenerate Windows icon assets from the ForgeFlow flow mark (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "desktop" / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)


def render(size: int) -> Image.Image:
    scale = 4
    s = size * scale
    unit = s / 64
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, s - 1, s - 1), radius=15 * unit, fill="#0f514c")
    width = round(4.5 * unit)
    for points in [[(18, 14), (18, 50)], [(18, 18), (38, 18)], [(18, 32), (32, 32)], [(18, 46), (38, 46)]]:
        draw.line([(round(x * unit), round(y * unit)) for x, y in points], fill="white", width=width, joint="curve")
        for x, y in (points[0], points[-1]):
            r = width / 2
            draw.ellipse((x * unit - r, y * unit - r, x * unit + r, y * unit + r), fill="white")
    for x, y in [(45, 18), (39, 32), (45, 46)]:
        draw.ellipse(((x - 5) * unit, (y - 5) * unit, (x + 5) * unit, (y + 5) * unit), fill="#a7f3d0")
    return image.resize((size, size), Image.Resampling.LANCZOS)


icon = render(256)
icon.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
icon.save(OUT / "icon.png")
(OUT / "icon.rgba").write_bytes(render(32).tobytes())
