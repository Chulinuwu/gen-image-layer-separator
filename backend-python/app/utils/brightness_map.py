from PIL import Image, ImageFilter
from io import BytesIO
import numpy as np


def generate_brightness_heatmap(image_buffer: bytes, size: int = 512) -> bytes:
    img = Image.open(BytesIO(image_buffer)).convert("RGB")
    aspect = img.height / img.width
    w = size
    h = int(size * aspect)
    img = img.resize((w, h), Image.LANCZOS)

    arr = np.array(img, dtype=np.float32)
    luminance = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]

    lum_img = Image.fromarray(luminance.astype(np.uint8), mode="L")
    lum_img = lum_img.filter(ImageFilter.GaussianBlur(radius=15))
    luminance = np.array(lum_img, dtype=np.float32)

    lmin, lmax = luminance.min(), luminance.max()
    if lmax > lmin:
        luminance = (luminance - lmin) / (lmax - lmin) * 255

    heatmap = np.zeros((h, w, 3), dtype=np.uint8)
    norm = luminance / 255.0

    # Blue channel: strong in dark areas, fades in bright
    heatmap[:, :, 2] = (np.clip(1.0 - norm * 2, 0, 1) * 255).astype(np.uint8)
    # Green channel: peaks in middle
    heatmap[:, :, 1] = (np.clip(1.0 - np.abs(norm - 0.5) * 3, 0, 1) * 200).astype(np.uint8)
    # Red channel: strong in bright areas
    heatmap[:, :, 0] = (np.clip(norm * 2 - 0.5, 0, 1) * 255).astype(np.uint8)

    result = Image.fromarray(heatmap, mode="RGB")

    buf = BytesIO()
    result.save(buf, format="JPEG", quality=80)
    return buf.getvalue()
