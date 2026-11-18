"""Draw the taichi-dsh icons in the same flat mark style as the whale assets.

build/app-icon.png matches the window icon: near-black shape, white negative
space, transparent margin. build/icon.png matches the in-app favicon: the same
taiji in the whale blue on the light canvas. icon.ico and icon.icns are packed
from the window icon so Windows and macOS packaging do not need sips.
"""
from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'build'
SIZE = 1024
CENTER = SIZE / 2
RADIUS = 420
HALF = RADIUS / 2
EYE = RADIUS * 0.13
SAMPLES = 4

DARK = (13, 22, 22, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)
BLUE = (70, 111, 249, 255)
CANVAS = (249, 249, 252, 255)


def region(x: float, y: float, size: float, radius_ratio: float, eye_ratio: float, min_eye: float) -> str:
  center = size / 2
  radius = size * radius_ratio
  half = radius / 2
  eye = max(radius * eye_ratio, min_eye)
  dx = x - center
  dy = y - center
  if dx * dx + dy * dy > radius * radius:
    return 'outside'
  upper = (dx * dx) + (dy + half) * (dy + half) <= half * half
  lower = (dx * dx) + (dy - half) * (dy - half) <= half * half
  if upper and (dx * dx) + (dy + half) * (dy + half) <= eye * eye:
    return 'dark'
  if lower and (dx * dx) + (dy - half) * (dy - half) <= eye * eye:
    return 'light'
  if upper or (dx >= 0 and not lower):
    return 'light'
  return 'dark'


def render(
  outside: tuple[int, int, int, int],
  dark: tuple[int, int, int, int],
  light: tuple[int, int, int, int],
  size: int = SIZE,
  samples: int = SAMPLES,
  radius_ratio: float = RADIUS / SIZE,
  eye_ratio: float = EYE / RADIUS,
  min_eye: float = 0
) -> Image.Image:
  pixels = bytearray(size * size * 4)
  step = 1 / samples
  origin = step / 2
  for y in range(size):
    row = y * size * 4
    for x in range(size):
      red = green = blue = alpha = 0
      for sy in range(samples):
        for sx in range(samples):
          kind = region(x + origin + sx * step, y + origin + sy * step, size, radius_ratio, eye_ratio, min_eye)
          color = outside if kind == 'outside' else dark if kind == 'dark' else light
          red += color[0]
          green += color[1]
          blue += color[2]
          alpha += color[3]
      count = samples * samples
      pixels[row + x * 4] = red // count
      pixels[row + x * 4 + 1] = green // count
      pixels[row + x * 4 + 2] = blue // count
      pixels[row + x * 4 + 3] = alpha // count
  return Image.frombytes('RGBA', (size, size), bytes(pixels))


def write_icns(images: dict[str, bytes], destination: Path) -> None:
  chunks = bytearray()
  for kind, payload in images.items():
    chunks += kind.encode('ascii')
    chunks += struct.pack('>I', 8 + len(payload))
    chunks += payload
  destination.write_bytes(b'icns' + struct.pack('>I', 8 + len(chunks)) + chunks)


def png_bytes(image: Image.Image) -> bytes:
  # Pillow's PNG writer, kept in memory for the icon containers.
  from io import BytesIO
  buffer = BytesIO()
  image.save(buffer, format='PNG')
  return buffer.getvalue()


def main() -> None:
  window = render(CLEAR, DARK, WHITE)
  favicon = render(CANVAS, BLUE, CANVAS)
  window_path = BUILD / 'app-icon.png'
  favicon_path = BUILD / 'icon.png'
  window.save(window_path)
  favicon.save(favicon_path)
  # Tray slots are 16 logical pixels. Draw those sizes directly so Windows does not
  # scale a 1024 image down with a hard edge.
  for tray_size in (16, 20, 24, 32, 40, 48, 64):
    render(CLEAR, DARK, WHITE, size=tray_size, samples=8, radius_ratio=0.46, eye_ratio=0.22, min_eye=1.35).save(
      BUILD / f'tray-icon-{tray_size}.png'
    )
  window.save(BUILD / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
  icns_types = {
    16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10'
  }
  write_icns({
    kind: png_bytes(window.resize((size, size), Image.Resampling.LANCZOS))
    for size, kind in icns_types.items()
  }, BUILD / 'icon.icns')
  print(f'Wrote {window_path.name} and {favicon_path.name}')


if __name__ == '__main__':
  main()
