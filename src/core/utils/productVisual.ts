const EMOJI_PREFIX = 'emoji:';
const SAFE_IMAGE_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.jpg$/;

export type ProductVisual =
  | { readonly kind: 'IMAGE'; readonly fileName: string }
  | { readonly kind: 'EMOJI'; readonly emoji: string }
  | { readonly kind: 'NONE' };

// Codifico emojis con prefijo explícito en la columna image_uri para reutilizar el esquema SQLite sin migraciones destructivas.
export function encodeEmojiVisual(rawEmoji: string): string {
  const cleaned = rawEmoji.replace(/\s+/g, '').trim();
  return `${EMOJI_PREFIX}${cleaned}`;
}

export function isStoredImageFileName(value: string | null): value is string {
  return value !== null && SAFE_IMAGE_FILENAME_REGEX.test(value);
}

export function parseProductVisual(rawValue: string | null): ProductVisual {
  if (rawValue === null || rawValue.length === 0) {
    return { kind: 'NONE' };
  }

  if (rawValue.startsWith(EMOJI_PREFIX)) {
    const emoji = rawValue.slice(EMOJI_PREFIX.length).trim();
    if (emoji.length > 0) {
      return { kind: 'EMOJI', emoji };
    }
    return { kind: 'NONE' };
  }

  if (SAFE_IMAGE_FILENAME_REGEX.test(rawValue)) {
    return { kind: 'IMAGE', fileName: rawValue };
  }

  return { kind: 'NONE' };
}