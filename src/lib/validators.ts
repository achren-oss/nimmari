const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIGNATURE_BYTES = 500 * 1024;

export function isValidSignaturePng(value: unknown): value is string {
  if (typeof value !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return false;
  const encoded = value.slice("data:image/png;base64,".length);
  if (/[^A-Za-z0-9+/=]/.test(encoded)) return false;
  if (encoded.length > Math.ceil(MAX_SIGNATURE_BYTES / 3) * 4) return false;
  // Buffer decoding is permissive; reject malformed padding and base64 too.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length <= MAX_SIGNATURE_BYTES && bytes.subarray(0, 8).equals(PNG_MAGIC);
}
