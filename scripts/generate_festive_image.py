from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "imagegen" / "festive-moments-square.png"
SIZE = 1080


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """加载适合中文展示的系统字体，缺失时回退到 Pillow 默认字体。"""
    candidates = [
        Path(r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ]
    for font_path in candidates:
        if font_path.exists():
            return ImageFont.truetype(str(font_path), size=size)
    return ImageFont.load_default()


def lerp_color(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    """按比例混合两个 RGB 颜色。"""
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_background(draw: ImageDraw.ImageDraw) -> None:
    """绘制红金径向氛围背景。"""
    center = (SIZE * 0.48, SIZE * 0.38)
    max_dist = math.hypot(SIZE, SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            d = math.hypot(x - center[0], y - center[1]) / max_dist
            vertical = y / SIZE
            base = lerp_color((176, 13, 22), (86, 0, 18), min(1, vertical * 1.1))
            glow = lerp_color((255, 215, 103), base, min(1, d * 3.2))
            draw.point((x, y), fill=lerp_color(glow, base, 0.34))


def draw_sparkles(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    """绘制金色星点和细小光斑，增强节庆氛围。"""
    for _ in range(180):
        x = rng.randint(40, SIZE - 40)
        y = rng.randint(40, SIZE - 40)
        r = rng.choice([1, 1, 2, 3])
        alpha_color = rng.choice([(255, 232, 142), (255, 196, 73), (255, 245, 194)])
        draw.ellipse((x - r, y - r, x + r, y + r), fill=alpha_color)
        if r >= 2:
            draw.line((x - 7, y, x + 7, y), fill=alpha_color, width=1)
            draw.line((x, y - 7, x, y + 7), fill=alpha_color, width=1)


def draw_firework(draw: ImageDraw.ImageDraw, cx: int, cy: int, radius: int, color: tuple[int, int, int]) -> None:
    """绘制单个放射状烟花。"""
    for i in range(28):
        angle = (math.tau / 28) * i
        inner = radius * 0.22
        outer = radius * (0.78 + 0.18 * math.sin(i * 1.7))
        x1 = cx + math.cos(angle) * inner
        y1 = cy + math.sin(angle) * inner
        x2 = cx + math.cos(angle) * outer
        y2 = cy + math.sin(angle) * outer
        draw.line((x1, y1, x2, y2), fill=color, width=3)
        draw.ellipse((x2 - 4, y2 - 4, x2 + 4, y2 + 4), fill=(255, 236, 172))
    draw.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=(255, 255, 220))


def draw_cloud(draw: ImageDraw.ImageDraw, x: int, y: int, scale: float, color: tuple[int, int, int]) -> None:
    """用圆弧和线条绘制装饰性祥云。"""
    w = int(170 * scale)
    h = int(72 * scale)
    stroke = max(3, int(6 * scale))
    draw.arc((x, y, x + h, y + h), 180, 360, fill=color, width=stroke)
    draw.arc((x + int(45 * scale), y - int(22 * scale), x + int(125 * scale), y + int(58 * scale)), 180, 360, fill=color, width=stroke)
    draw.arc((x + int(100 * scale), y, x + int(175 * scale), y + h), 180, 360, fill=color, width=stroke)
    draw.line((x, y + h // 2, x + w, y + h // 2), fill=color, width=stroke)
    draw.arc((x + int(35 * scale), y + int(18 * scale), x + int(88 * scale), y + int(71 * scale)), 0, 310, fill=color, width=stroke)


def draw_lantern(draw: ImageDraw.ImageDraw, cx: int, top: int, scale: float) -> None:
    """绘制红金灯笼装饰。"""
    w = int(138 * scale)
    h = int(182 * scale)
    left = cx - w // 2
    right = cx + w // 2
    bottom = top + h
    gold = (255, 205, 78)
    red = (215, 25, 36)
    dark = (133, 0, 20)

    draw.line((cx, top - int(78 * scale), cx, top), fill=gold, width=max(2, int(4 * scale)))
    draw.rounded_rectangle((left + int(18 * scale), top - int(12 * scale), right - int(18 * scale), top + int(18 * scale)), radius=10, fill=gold)
    draw.rounded_rectangle((left + int(18 * scale), bottom - int(18 * scale), right - int(18 * scale), bottom + int(12 * scale)), radius=10, fill=gold)
    draw.ellipse((left, top, right, bottom), fill=red, outline=gold, width=max(4, int(7 * scale)))
    for i in range(1, 4):
        offset = int((i - 2) * w * 0.22)
        draw.arc((left + offset, top, right + offset, bottom), 95, 265, fill=(255, 126, 71), width=max(2, int(4 * scale)))
    draw.rectangle((cx - int(10 * scale), bottom + int(10 * scale), cx + int(10 * scale), bottom + int(62 * scale)), fill=gold)
    for i in range(5):
        x = cx + int((i - 2) * 12 * scale)
        draw.line((x, bottom + int(58 * scale), x + int((i - 2) * 4 * scale), bottom + int(108 * scale)), fill=dark, width=max(2, int(3 * scale)))


def draw_gold_frame(draw: ImageDraw.ImageDraw) -> None:
    """绘制适合朋友圈封面的金色双线边框。"""
    margin = 46
    draw.rounded_rectangle((margin, margin, SIZE - margin, SIZE - margin), radius=42, outline=(255, 213, 94), width=8)
    draw.rounded_rectangle((margin + 18, margin + 18, SIZE - margin - 18, SIZE - margin - 18), radius=32, outline=(255, 234, 166), width=2)
    for x, y in [(78, 78), (SIZE - 78, 78), (78, SIZE - 78), (SIZE - 78, SIZE - 78)]:
        draw.ellipse((x - 13, y - 13, x + 13, y + 13), fill=(255, 225, 116))


def draw_text_block(image: Image.Image) -> None:
    """绘制居中的中文祝福文字。"""
    draw = ImageDraw.Draw(image)
    title_font = load_font(124, bold=True)
    sub_font = load_font(42)
    micro_font = load_font(28)

    title = "喜乐安康"
    subtitle = "好运常伴 · 万事顺意"
    micro = "HAPPY MOMENTS"

    title_box = draw.textbbox((0, 0), title, font=title_font)
    title_w = title_box[2] - title_box[0]
    x = (SIZE - title_w) // 2
    y = 448

    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text((x + 5, y + 8), title, font=title_font, fill=(90, 0, 0, 180))
    shadow = shadow.filter(ImageFilter.GaussianBlur(3))
    image.alpha_composite(shadow)

    for dx, dy in [(-2, 0), (2, 0), (0, -2), (0, 2)]:
        draw.text((x + dx, y + dy), title, font=title_font, fill=(122, 37, 0))
    draw.text((x, y), title, font=title_font, fill=(255, 236, 154))

    sub_box = draw.textbbox((0, 0), subtitle, font=sub_font)
    sub_w = sub_box[2] - sub_box[0]
    draw.rounded_rectangle((SIZE // 2 - 270, 614, SIZE // 2 + 270, 690), radius=38, fill=(116, 0, 19), outline=(255, 205, 83), width=3)
    draw.text(((SIZE - sub_w) // 2, 628), subtitle, font=sub_font, fill=(255, 224, 132))

    micro_box = draw.textbbox((0, 0), micro, font=micro_font)
    micro_w = micro_box[2] - micro_box[0]
    draw.text(((SIZE - micro_w) // 2, 720), micro, font=micro_font, fill=(255, 210, 104))


def build_image() -> Image.Image:
    """构建完整的方形喜庆朋友圈图片。"""
    rng = random.Random(20260618)
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
    draw = ImageDraw.Draw(image)

    draw_background(draw)
    draw_firework(draw, 190, 190, 110, (255, 219, 108))
    draw_firework(draw, 890, 210, 96, (255, 173, 78))
    draw_firework(draw, 820, 842, 86, (255, 231, 139))
    draw_sparkles(draw, rng)

    for x, y, scale in [(82, 780, 1.05), (704, 118, 0.92), (120, 334, 0.68), (716, 715, 0.74)]:
        draw_cloud(draw, x, y, scale, (255, 207, 88))

    draw_lantern(draw, 280, 116, 0.82)
    draw_lantern(draw, 798, 96, 0.95)
    draw_lantern(draw, 134, 600, 0.62)

    draw_gold_frame(draw)
    draw_text_block(image)

    vignette = Image.new("RGBA", image.size, (0, 0, 0, 0))
    vignette_draw = ImageDraw.Draw(vignette)
    for i in range(80):
        alpha = int(i * 1.2)
        vignette_draw.rounded_rectangle((i, i, SIZE - i, SIZE - i), radius=48, outline=(90, 0, 16, alpha), width=2)
    image.alpha_composite(vignette)
    return image.convert("RGB")


def main() -> None:
    """生成图片文件并写入项目输出目录。"""
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    build_image().save(OUTPUT, quality=96)
    print(OUTPUT)


if __name__ == "__main__":
    main()
