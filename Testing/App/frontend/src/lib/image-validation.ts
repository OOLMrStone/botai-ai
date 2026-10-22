import { INTEGRATION } from '@/config/integration';
export type ImageRejection =
  'file_type' | 'file_size' | 'image_count' | 'image_dimensions' | 'decode_failed';
export async function imageRejection(file: File): Promise<ImageRejection | null> {
  if (!INTEGRATION.imageTypes.some((type) => type === file.type)) return 'file_type';
  if (file.size > INTEGRATION.maxImageBytes) return 'file_size';
  try {
    const image = await createImageBitmap(file);
    const invalid =
      image.width * image.height > INTEGRATION.maxImagePixels ||
      Math.max(image.width, image.height) > INTEGRATION.maxImageDimension;
    image.close();
    return invalid ? 'image_dimensions' : null;
  } catch {
    return 'decode_failed';
  }
}
