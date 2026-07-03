/**
 * Decode a TIFF file to a PNG object URL + dimensions using lazily imported
 * 'utif2'. Throws Error('TIFF konnte nicht dekodiert werden') on failure.
 */
export async function decodeTiff(file: File): Promise<{ url: string; width: number; height: number }> {
  try {
    const UTIF = await import('utif2');
    const buffer = await file.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    const ifd = ifds[0];
    if (!ifd) throw new Error('no IFD');
    UTIF.decodeImage(buffer, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const width = ifd.width;
    const height = ifd.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(imageData, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('toBlob failed');

    return { url: URL.createObjectURL(blob), width, height };
  } catch {
    throw new Error('TIFF konnte nicht dekodiert werden');
  }
}
