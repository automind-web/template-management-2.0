// Генерирует иконки приложения (PWA) в /public: акцентный фон и белая галочка.
// Запуск: node scripts/make-icons.mjs [#2f5bea]
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const hex = (process.argv[2] ?? "#2f5bea").replace("#", "");
const [R, G, B] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Расстояние от точки до отрезка — для сглаженной галочки. */
function dist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const s = size / 100;
  const stroke = 9 * s;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.min(dist(x, y, 30 * s, 52 * s, 44 * s, 66 * s), dist(x, y, 44 * s, 66 * s, 71 * s, 37 * s));
      const a = Math.max(0, Math.min(1, stroke / 2 - d + 0.5));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(R + (255 - R) * a);
      raw[o + 1] = Math.round(G + (255 - G) * a);
      raw[o + 2] = Math.round(B + (255 - B) * a);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
import { mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(`public/${name}`, png(size));
}
console.log("✓ Иконки: public/icon-192.png, icon-512.png, apple-touch-icon.png");
