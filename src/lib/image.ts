/**
 * Fotos im Browser verkleinern, bevor sie hochgeladen werden.
 *
 * Ein unbearbeitetes Handyfoto sind schnell 4 MB. Das will niemand über
 * Hotel-WLAN hochladen, und im Repo hätte es auch nichts verloren.
 */

export interface ResizedPhoto {
  /** Reines Base64 ohne «data:»-Präfix — genau so erwartet es die Function. */
  base64: string;
  ext: 'webp' | 'jpg';
  bytes: number;
  /** Object-URL für die Vorschau. Muss vom Aufrufer freigegeben werden. */
  previewUrl: string;
}

export class PhotoError extends Error {}

const MAX_EDGE = 1600;
const MAX_BYTES = 1_400_000;

export async function resizePhoto(file: File): Promise<ResizedPhoto> {
  const source = await decode(file);
  const { width, height } = fit(source.width, source.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new PhotoError('Das Bild konnte nicht verarbeitet werden.');
  context.drawImage(source.image, 0, 0, width, height);
  source.release();

  // Erst WebP versuchen. Browser, die es nicht können, liefern hier klaglos ein
  // PNG zurück — deshalb wird der Typ geprüft und nicht bloss gehofft.
  let blob = await toBlob(canvas, 'image/webp', 0.8);
  let ext: 'webp' | 'jpg' = 'webp';

  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob(canvas, 'image/jpeg', 0.82);
    ext = 'jpg';
  }
  if (!blob) throw new PhotoError('Das Bild konnte nicht umgewandelt werden.');

  // Noch zu gross: einmal mit kräftigerer Kompression nachlegen.
  if (blob.size > MAX_BYTES) {
    const retry = await toBlob(canvas, ext === 'webp' ? 'image/webp' : 'image/jpeg', 0.6);
    if (retry && retry.size < blob.size) blob = retry;
  }
  if (blob.size > MAX_BYTES) {
    throw new PhotoError('Das Foto ist auch verkleinert noch zu gross. Bitte ein anderes wählen.');
  }

  return {
    base64: await toBase64(blob),
    ext,
    bytes: blob.size,
    previewUrl: URL.createObjectURL(blob),
  };
}

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * `createImageBitmap` ist der schnelle Weg, fehlt aber auf älteren Geräten —
 * und scheitert an HEIC, das iPhones manchmal doch durchreichen. Beides wird
 * hier abgefangen, damit statt eines stillen Fehlers eine Erklärung erscheint.
 */
async function decode(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Weiter mit dem klassischen Weg.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('decode failed'));
      element.src = url;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoError(
      file.name.toLowerCase().endsWith('.heic')
        ? 'HEIC-Bilder kann dieser Browser nicht öffnen. Im iPhone unter Einstellungen → Kamera → Formate «Maximale Kompatibilität» wählen, oder einen Bildschirmfoto-Ausschnitt nehmen.'
        : 'Diese Bilddatei konnte nicht geöffnet werden.',
    );
  }
}

function fit(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return { width, height };
  const scale = MAX_EDGE / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function toBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // In Blöcken, weil String.fromCharCode(...bytes) bei grossen Bildern den Stack sprengt.
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
