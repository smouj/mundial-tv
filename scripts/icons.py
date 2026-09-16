#!/usr/bin/env python3
"""Genera el icono de Mundial TV.

Formas geométricas planas, sin efectos ni degradados llamativos: un triángulo
de reproducción en blanco con ondas de emisión en ámbar, sobre una baldosa
redondeada oscura. Todo se dibuja a 4x y se reduce con LANCZOS, que es lo que
da el borde limpio en los tamaños pequeños.

Salidas:
  build/icon.png         1024x1024, icono completo (Linux, documentación)
  build/icon.ico         múltiples tamaños, para el ejecutable de Windows
  src/assets/mark.png    solo el símbolo, fondo transparente, para la interfaz
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

# Lienzo de referencia y factor de supermuestreo.
UNIT = 1024
SCALE = 4
SIZE = UNIT * SCALE

ROOT = pathlib.Path(__file__).resolve().parent.parent

BACKGROUND_TOP = (30, 43, 58)
BACKGROUND_BOTTOM = (11, 16, 22)
INK = (245, 249, 252, 255)
ACCENT = (240, 165, 60)

# Geometría del símbolo, en el lienzo de 1024. Las ondas nacen en la punta del
# triángulo y el conjunto queda ópticamente centrado en la baldosa: el símbolo
# ocupa de x=250 a x=770 y de y=296 a y=728.
TRIANGLE = [(250, 372), (250, 652), (470, 512)]
WAVE_CENTER = (470, 512)
WAVES = [(120, 34, 255), (210, 30, 225), (300, 26, 190)]
WAVE_SPREAD = 46


def px(value: float) -> float:
    return value * SCALE


def rounded_mask() -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=px(226), fill=255)
    return mask


def gradient() -> Image.Image:
    column = Image.new("RGB", (1, SIZE))
    for y in range(SIZE):
        ratio = y / (SIZE - 1)
        column.putpixel(
            (0, y),
            tuple(
                round(BACKGROUND_TOP[i] + (BACKGROUND_BOTTOM[i] - BACKGROUND_TOP[i]) * ratio)
                for i in range(3)
            ),
        )
    return column.resize((SIZE, SIZE), Image.Resampling.NEAREST)


def draw_symbol(image: Image.Image) -> None:
    """Dibuja el triángulo y las ondas de emisión sobre una capa RGBA."""
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for radius, width, alpha in WAVES:
        box = [
            px(WAVE_CENTER[0] - radius),
            px(WAVE_CENTER[1] - radius),
            px(WAVE_CENTER[0] + radius),
            px(WAVE_CENTER[1] + radius),
        ]
        draw.arc(
            box,
            start=-WAVE_SPREAD,
            end=WAVE_SPREAD,
            fill=ACCENT + (alpha,),
            width=round(px(width)),
        )

    draw.polygon([(px(x), px(y)) for x, y in TRIANGLE], fill=INK)
    image.alpha_composite(overlay)


def build_tile() -> Image.Image:
    """Icono completo: baldosa redondeada con el símbolo encima."""
    tile = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    tile.paste(gradient().convert("RGBA"), (0, 0), rounded_mask())

    # Filo interior muy tenue: separa la baldosa del fondo del escritorio.
    edge = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        [0, 0, SIZE - 1, SIZE - 1],
        radius=px(226),
        outline=(255, 255, 255, 26),
        width=round(px(6)),
    )
    tile.alpha_composite(edge)

    draw_symbol(tile)
    return tile


def build_mark() -> Image.Image:
    """Símbolo suelto, sin fondo, recortado a su caja real."""
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_symbol(layer)
    box = layer.getbbox()
    if box is not None:
        padding = round(px(18))
        layer = layer.crop(
            (
                max(0, box[0] - padding),
                max(0, box[1] - padding),
                min(SIZE, box[2] + padding),
                min(SIZE, box[3] + padding),
            )
        )
    side = max(layer.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(layer, ((side - layer.width) // 2, (side - layer.height) // 2))
    return square


def main() -> None:
    build = ROOT / "build"
    assets = ROOT / "src" / "assets"
    build.mkdir(parents=True, exist_ok=True)
    assets.mkdir(parents=True, exist_ok=True)

    tile = build_tile().resize((UNIT, UNIT), Image.Resampling.LANCZOS)
    tile.save(build / "icon.png", "PNG")

    icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    tile.save(build / "icon.ico", "ICO", sizes=icon_sizes)

    mark = build_mark().resize((256, 256), Image.Resampling.LANCZOS)
    mark.save(assets / "mark.png", "PNG")

    print(f"build/icon.png {tile.size[0]}x{tile.size[1]}")
    print(f"build/icon.ico {len(icon_sizes)} tamaños")
    print(f"src/assets/mark.png {mark.size[0]}x{mark.size[1]}")


if __name__ == "__main__":
    main()
