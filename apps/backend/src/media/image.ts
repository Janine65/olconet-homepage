import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40000000;

export async function normalizeImage(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestException('Bild muss zwischen 1 Byte und 10 MiB gross sein.');
  }
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) {
      throw new BadRequestException('Nur nicht animierte JPEG-, PNG- und WebP-Bilder sind erlaubt.');
    }
    // Re-encoding removes EXIF/GPS metadata and applies the camera orientation.
    return await image.rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    if (error instanceof Error && /memory|disk|allocation/i.test(error.message)) throw error;
    throw new BadRequestException('Das Bild ist ungueltig, beschaedigt oder hat mehr als 40 Millionen Pixel.');
  }
}
