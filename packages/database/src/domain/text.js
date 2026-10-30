// Text normalization shared by catalogue identity (variant keys) and external matching.
export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(\d)\s+(?=[a-z])/g, '$1') // "400 g" -> "400g"
    .trim();
}
