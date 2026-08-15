// Screenshot reading for the visual-path case: it has to find its targets in the
// image the browser produced, the same way an agent on the visual path would,
// instead of asking the DOM where they are.
//
// The decoder is written out here rather than pulled from a package because
// Chromium screenshots are a narrow slice of the format — 8-bit, non-interlaced,
// RGB or RGBA — and node:zlib already supplies the only hard part.

import { inflateSync } from "node:zlib";

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a PNG image");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const parts = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      parts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const channels = CHANNELS_BY_COLOR_TYPE[colorType] ?? 0;
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(
      `unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`,
    );
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const previous =
      y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        const nearest =
          dLeft <= dUp && dLeft <= dUpLeft
            ? left
            : dUp <= dUpLeft
              ? up
              : upLeft;
        value = (value + nearest) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG row filter: ${filter}`);
      }
      row[x] = value;
    }
  }
  return { width, height, channels, pixels };
}

export function pixelAt(image, x, y) {
  const index = (y * image.width + x) * image.channels;
  return [
    image.pixels[index],
    image.pixels[index + 1],
    image.pixels[index + 2],
  ];
}

function scan(image, rgb, region, visit) {
  const x0 = Math.max(0, region?.x0 ?? 0);
  const y0 = Math.max(0, region?.y0 ?? 0);
  const x1 = Math.min(image.width, region?.x1 ?? image.width);
  const y1 = Math.min(image.height, region?.y1 ?? image.height);
  const [r, g, b] = rgb;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * image.width + x) * image.channels;
      if (image.pixels[index] !== r) continue;
      if (image.pixels[index + 1] !== g) continue;
      if (image.pixels[index + 2] !== b) continue;
      visit(x, y);
    }
  }
}

// Finds the one region painted in `rgb` and reports it in device pixels. `fill`
// is how much of the bounding box actually carries the colour: a solid
// rectangle reports 1, and anything materially lower means stray pixels of the
// same value widened the box and the centre can no longer be trusted.
export function locateSwatch(image, rgb, region) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  scan(image, rgb, region, (x, y) => {
    count += 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  if (!count) return null;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return {
    count,
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    fill: count / (width * height),
    // +1 because minX/maxX are pixel indices: a swatch covering columns 240..319
    // spans the geometry from 240 to 320, whose centre is 280, not 279.5.
    centerX: (minX + maxX + 1) / 2,
    centerY: (minY + maxY + 1) / 2,
  };
}

// A screenshot taken at the default scale is device pixels; page.mouse takes
// CSS pixels. The visual path reads its coordinates from a scale:'css'
// screenshot instead, so this conversion is what that reading is checked
// against rather than how it is produced.
export function toCssPoint(box, ratio) {
  return { x: box.centerX / ratio, y: box.centerY / ratio };
}
