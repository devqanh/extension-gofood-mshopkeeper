from argparse import ArgumentParser
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICON_MASTER = ROOT / "assets" / "icons" / "gofood-vietqr-master.png"
PROMO_MASTER = ROOT / "store-assets" / "promo-master.png"
ICON_DIR = ROOT / "assets" / "icons"
STORE_DIR = ROOT / "store-assets"


def crop_to_ratio(image: Image.Image, ratio: float, anchor_y: float = 0.5) -> Image.Image:
    width, height = image.size
    current_ratio = width / height

    if current_ratio > ratio:
        crop_width = round(height * ratio)
        left = (width - crop_width) // 2
        return image.crop((left, 0, left + crop_width, height))

    crop_height = round(width / ratio)
    top = round((height - crop_height) * anchor_y)
    top = max(0, min(top, height - crop_height))
    return image.crop((0, top, width, top + crop_height))


def build_icons() -> None:
    source = Image.open(ICON_MASTER).convert("RGBA")
    alpha_box = source.getchannel("A").getbbox()
    if not alpha_box:
        raise RuntimeError("Logo master has no visible pixels")

    artwork = source.crop(alpha_box)
    for size in (16, 32, 48, 128):
        artwork_size = round(size * 0.75)
        resized = artwork.copy()
        resized.thumbnail((artwork_size, artwork_size), Image.Resampling.LANCZOS)

        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        position = ((size - resized.width) // 2, (size - resized.height) // 2)
        canvas.alpha_composite(resized, position)
        canvas.save(ICON_DIR / f"icon-{size}.png", optimize=True)


def build_promos() -> None:
    source = Image.open(PROMO_MASTER).convert("RGB")
    for filename, size in (
        ("promo-small-440x280.png", (440, 280)),
        ("promo-marquee-1400x560.png", (1400, 560)),
    ):
        cropped = crop_to_ratio(source, size[0] / size[1])
        output = cropped.resize(size, Image.Resampling.LANCZOS)
        output.save(STORE_DIR / filename, optimize=True)


def build_screenshot(source_path: Path) -> None:
    source = Image.open(source_path).convert("RGB")
    cropped = crop_to_ratio(source, 1280 / 800, anchor_y=0)
    output = cropped.resize((1280, 800), Image.Resampling.LANCZOS)
    output.save(STORE_DIR / "screenshot-01-vietqr-1280x800.png", optimize=True)


def main() -> None:
    parser = ArgumentParser(description="Build Chrome Web Store image assets.")
    parser.add_argument(
        "--screenshot-source",
        type=Path,
        help="Optional real product screenshot to crop from the top to 1280x800.",
    )
    args = parser.parse_args()

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    build_icons()
    build_promos()

    if args.screenshot_source:
        build_screenshot(args.screenshot_source)


if __name__ == "__main__":
    main()
