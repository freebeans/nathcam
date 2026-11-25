/** EXIF (TIFF) do arquivo original: JPEG, HEIC ou RAW em formato TIFF. */
import { extractHeicExif } from './heif-container';
import { extractExif } from './jpeg';
import { extractTiffRawExif } from './tiff-exif';

export function extractAnyExif(file: Uint8Array): Uint8Array | null {
  if (file[0] === 0xff && file[1] === 0xd8) return extractExif(file);
  if ((file[0] === 0x49 && file[1] === 0x49) || (file[0] === 0x4d && file[1] === 0x4d)) return extractTiffRawExif(file);
  return extractHeicExif(file);
}
