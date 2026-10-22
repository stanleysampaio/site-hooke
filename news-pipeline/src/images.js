import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

let s3 = null;

const WIDTH = 1200;
const HEIGHT = 675;
// Logo amarelo da Hooke (cópia de img/logo_amarela.png do site).
const WATERMARK = path.join(config.root, 'assets', 'watermark.png');
let watermarkPromise = null;

// Marca d'água: logo no canto inferior direito, sobre uma faixa escura
// translúcida para continuar legível em fotos claras.
async function buildWatermark() {
  const logoWidth = 150;
  const logo = await sharp(WATERMARK).resize({ width: logoWidth }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < logo.data.length; i += 4) logo.data[i] = Math.round(logo.data[i] * 0.92);
  const logoPng = await sharp(logo.data, { raw: logo.info }).png().toBuffer();

  const padX = 16, padY = 12, margin = 22;
  const w = logo.info.width + padX * 2;
  const h = logo.info.height + padY * 2;
  const plate = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="12" fill="#14171a" fill-opacity="0.45"/></svg>`
  );
  const left = WIDTH - w - margin;
  const top = HEIGHT - h - margin;
  return [
    { input: plate, left, top },
    { input: logoPng, left: left + padX, top: top + padY },
  ];
}

// Padroniza para o formato dos cards do site (16:9), aplica a marca d'água da
// Hooke e reduz o peso.
export async function optimizeImage(buffer) {
  watermarkPromise = watermarkPromise || buildWatermark();
  const resized = await sharp(buffer)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
    .toBuffer();
  return sharp(resized)
    .composite(await watermarkPromise)
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

// Envia para o bucket do site e devolve o caminho relativo usado pelo front
// (ex.: /img/noticias/<id>.jpg). Em dry-run grava em ./out.
export async function storeImage(id, buffer, { dryRun }) {
  const key = `${config.s3Prefix}${id}.jpg`;

  if (dryRun) {
    const file = path.join(config.outDir, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    return `/${key}`;
  }

  if (!config.s3Bucket) throw new Error('S3_BUCKET não configurado');
  // Credenciais pela cadeia padrão da AWS (IAM role da EC2 ou AWS_ACCESS_KEY_ID/SECRET no .env).
  s3 = s3 || new S3Client({ region: config.s3Region });
  await s3.send(new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
    // O nome é único por notícia, então pode ficar em cache para sempre.
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `/${key}`;
}
