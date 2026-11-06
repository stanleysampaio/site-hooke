import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

let s3 = null;

const WIDTH = 1200;
const HEIGHT = 675;
// Logo da Hooke (cópia de img/logo_amarela.png do site). Só o formato é usado:
// a cor vem de buildWatermark.
const WATERMARK = path.join(config.root, 'assets', 'watermark.png');
// O nome "HOOKE" ocupa esta fração da altura do arquivo; o resto é o subtítulo,
// que fica ilegível em tamanho pequeno.
const LOGO_NAME_HEIGHT = 0.82;
const WATERMARK_OPACITY = 0.55;
let watermarkPromise = null;

// Marca d'água: logo branco translúcido no canto inferior direito, sem fundo.
async function buildWatermark() {
  const logoWidth = 170;
  const margin = 26;
  const meta = await sharp(WATERMARK).metadata();
  const name = await sharp(WATERMARK)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.round(meta.height * LOGO_NAME_HEIGHT) })
    .toBuffer();
  const logo = await sharp(name).resize({ width: logoWidth }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < logo.data.length; i += 4) {
    logo.data[i] = logo.data[i + 1] = logo.data[i + 2] = 255;
    logo.data[i + 3] = Math.round(logo.data[i + 3] * WATERMARK_OPACITY);
  }
  const logoPng = await sharp(logo.data, { raw: logo.info }).png().toBuffer();
  return [{ input: logoPng, left: WIDTH - logo.info.width - margin, top: HEIGHT - logo.info.height - margin }];
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
