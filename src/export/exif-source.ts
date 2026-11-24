/** EXIF (TIFF) do arquivo original, seja JPEG ou HEIC. */
import { extractHeicExif } from './heic-exif';
import { extractExif } from './jpeg';

export function extractAnyExif(file: Uint8Array): Uint8Array | null {
  if (file[0] === 0xff && file[1] === 0xd8) return extractExif(file);
  return extractHeicExif(file);
}
