#!/usr/bin/env python3
import json
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
LAYERS = ROOT / "resources" / "icon-layers"
ICONSET = ROOT / "resources" / "MT-Aigis.iconset"
APPICONSET = ROOT / "resources" / "MT-Aigis.xcassets" / "AppIcon.appiconset"
ICON_DOCUMENT = ROOT / "resources" / "MT-Aigis.icon"


def vertical_gradient(size, top, bottom):
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(round(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(4))
        for x in range(size):
            pixels[x, y] = color
    return image


def crop_to_content(image, padding=0):
    bbox = image.getbbox()
    if not bbox:
        return image
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(image.width, bbox[2] + padding)
    bottom = min(image.height, bbox[3] + padding)
    return image.crop((left, top, right, bottom))


def rounded_mask(size, inset, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=radius,
        fill=255,
    )
    return mask


def rounded_rect_mask(size, box, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    return mask


def solid_surface(size, color):
    return Image.new("RGBA", (size, size), color)


def legacy_edge_overlay(size, tile_box, dark):
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    outer = tuple(tile_box)
    inner = (tile_box[0] + 5, tile_box[1] + 5, tile_box[2] - 5, tile_box[3] - 5)
    draw.rounded_rectangle(
        outer,
        radius=190,
        outline=(255, 255, 255, 34 if dark else 56),
        width=2,
    )
    draw.rounded_rectangle(
        inner,
        radius=184,
        outline=(0, 0, 0, 46 if not dark else 82),
        width=1,
    )
    return overlay


def main():
    LAYERS.mkdir(parents=True, exist_ok=True)
    foreground = crop_to_content(Image.open(LAYERS / "foreground.png").convert("RGBA"), 8)
    foreground.thumbnail((842, 842), Image.Resampling.LANCZOS)

    light = solid_surface(1024, (251, 251, 252, 255))
    dark = solid_surface(1024, (16, 16, 17, 255))
    light.save(LAYERS / "background-light.png")
    dark.save(LAYERS / "background-dark.png")

    composer_foreground = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    composer_foreground.alpha_composite(
        foreground,
        ((1024 - foreground.width) // 2 + 8, (1024 - foreground.height) // 2 + 42),
    )
    composer_foreground.save(LAYERS / "foreground-1024.png")

    tile_box = (104, 104, 920, 920)
    mask = rounded_rect_mask(1024, tile_box, 186)
    shadow = mask.filter(ImageFilter.GaussianBlur(8))
    light_edge = legacy_edge_overlay(1024, tile_box, False)
    dark_edge = legacy_edge_overlay(1024, tile_box, True)
    light_edge.save(LAYERS / "legacy-edge-light.png")
    dark_edge.save(LAYERS / "legacy-edge-dark.png")

    def make_legacy(background, edge, name):
        legacy = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        shadow_layer = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        shadow_layer.putalpha(shadow.point(lambda value: round(value * 0.16)))
        legacy.alpha_composite(shadow_layer, (0, 8))
        tile = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        tile.paste(background, (0, 0), mask)
        legacy.alpha_composite(tile)
        legacy.alpha_composite(edge)
        legacy.alpha_composite(composer_foreground)
        legacy.save(LAYERS / name)
        return legacy

    legacy = make_legacy(light, light_edge, "legacy-master.png")
    legacy.save(ROOT / "resources" / "icon.png")
    make_legacy(dark, dark_edge, "legacy-dark.png")

    ICONSET.mkdir(parents=True, exist_ok=True)
    APPICONSET.mkdir(parents=True, exist_ok=True)
    appicon_images = []
    for size in (16, 32, 128, 256, 512):
        regular = legacy.resize((size, size), Image.Resampling.LANCZOS)
        retina = legacy.resize((size * 2, size * 2), Image.Resampling.LANCZOS)
        regular_name = f"icon_{size}x{size}.png"
        retina_name = f"icon_{size}x{size}@2x.png"
        for directory in (ICONSET, APPICONSET):
            regular.save(directory / regular_name)
            retina.save(directory / retina_name)
        appicon_images.extend([
            {
                "size": f"{size}x{size}",
                "idiom": "mac",
                "filename": regular_name,
                "scale": "1x",
            },
            {
                "size": f"{size}x{size}",
                "idiom": "mac",
                "filename": retina_name,
                "scale": "2x",
            },
        ])
    (APPICONSET / "Contents.json").write_text(
        json.dumps({
            "images": appicon_images,
            "info": {
                "author": "xcode",
                "version": 1,
            },
        }, indent=2) + "\n",
        encoding="utf-8",
    )

    if ICON_DOCUMENT.exists():
        shutil.rmtree(ICON_DOCUMENT)
    (ICON_DOCUMENT / "Assets").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(LAYERS / "foreground-1024.png", ICON_DOCUMENT / "Assets" / "foreground-1024.png")
    (ICON_DOCUMENT / "icon.json").write_text(
        json.dumps({
            "fill": {
                "automatic-gradient": "extended-srgb:0.96000,0.96000,0.97000,1.00000",
            },
            "groups": [
                {
                    "layers": [
                        {
                            "image-name": "foreground-1024.png",
                        },
                    ],
                },
            ],
            "supported-platforms": {
                "squares": [
                    "macOS",
                ],
            },
        }, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
