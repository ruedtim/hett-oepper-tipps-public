/**
 * Fotobytes in R2.
 *
 * Schlüsselschema: `<tipId>/<noteId>-<vorgangsAbdruck>.<webp|jpg>` — derselbe
 * Pfad, unter dem die Function /photos/* ausliefert und unter dem das Backup
 * die Datei nach public/photos/ legt. Der Vorgangs-Abdruck (api/submit.ts)
 * macht den Namen pro Einreichung eindeutig: Weder gleichzeitige Uploads noch
 * trash/-Einträge verschiedener Löschungen können sich so je überschreiben.
 *
 * Gelöscht wird nie sofort, sondern nach `trash/<key>` verschoben: Der
 * Verlaufs-Snapshot hält nur Metadaten, «Rückgängig» einer Löschung braucht
 * aber die Bytes zurück. trash/ bleibt liegen (Free Tier: 10 GB, ein Foto
 * ≤1.5 MB) — ein Aufräumjob ist bewusst nicht Teil dieses Umbaus.
 */

export function photoKey(tipId: string, fileName: string): string {
  return `${tipId}/${fileName}`;
}

export function photoContentType(key: string): string {
  return key.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
}

export async function putPhotoFromBase64(bucket: R2Bucket, key: string, base64: string): Promise<void> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  await bucket.put(key, bytes, { httpMetadata: { contentType: photoContentType(key) } });
}

/** R2 kennt kein Umbenennen: kopieren + löschen. Fehlende Objekte werden toleriert und geloggt. */
async function move(bucket: R2Bucket, from: string, to: string): Promise<void> {
  const object = await bucket.get(from);
  if (!object) {
    console.warn(`Foto fehlt in R2, übersprungen: ${from}`);
    return;
  }
  // Die Bytes ganz laden (≤1.5 MB) — ein Stream bräuchte eine bekannte Länge.
  await bucket.put(to, await object.arrayBuffer(), { httpMetadata: object.httpMetadata });
  await bucket.delete(from);
}

export async function moveToTrash(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (const key of keys) await move(bucket, key, `trash/${key}`);
}

export async function restoreFromTrash(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (const key of keys) await move(bucket, `trash/${key}`, key);
}
