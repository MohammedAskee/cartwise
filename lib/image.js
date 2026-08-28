const MAX_CHARS = 180_000;

/** Compress an image File to a JPEG data URL suitable for Firestore documents. */
export async function compressImage(file, maxPx = 720) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let quality = 0.74;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > MAX_CHARS && quality > 0.38) {
    quality -= 0.1;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  if (data.length > MAX_CHARS) {
    throw new Error("Image is still too large. Try a smaller photo.");
  }
  return data;
}
