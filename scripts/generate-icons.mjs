#!/usr/bin/env node
/**
 * Generates PWA / app icons from the ghost logo SVG.
 * Output: apps/web/public/icons/icon-{192,512}.png (+ maskable variants).
 * Requires `sharp` as a root devDependency.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'apps/web/public/icons');
mkdirSync(OUT, { recursive: true });

const sharp = (await import('sharp')).default;
const svg = readFileSync(resolve(ROOT, 'apps/web/public/logo.svg'), 'utf8');

const SIZES = [192, 512];

for (const size of SIZES) {
  const base = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  writeFileSync(resolve(OUT, `icon-${size}.png`), base);
  console.log(`  wrote icon-${size}.png`);

  const scaled = await sharp(Buffer.from(svg))
    .resize(Math.round(size * 0.82), Math.round(size * 0.82))
    .png()
    .toBuffer();
  const maskable = await sharp({
    create: { width: size, height: size, channels: 4, background: '#1a1035' },
  })
    .composite([{ input: scaled, gravity: 'center' }])
    .png()
    .toBuffer();
  writeFileSync(resolve(OUT, `icon-${size}-maskable.png`), maskable);
  console.log(`  wrote icon-${size}-maskable.png`);
}

console.log('Icons generated in', OUT);
