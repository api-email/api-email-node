const CHUNK = 0x8000;

/** Base64 without Buffer, so it works in every runtime. Chunked to stay under argument limits. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
