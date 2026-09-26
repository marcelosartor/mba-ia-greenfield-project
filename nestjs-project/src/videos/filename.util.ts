const MAX_BASE_NAME_LENGTH = 100;
const FALLBACK_BASE_NAME = 'video';

// Characters that are unsafe in a file name on some operating system, plus
// control characters (a newline in a header would be an injection).
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

/** Extension of a storage key such as `channel/video/source.mp4` (no dot). */
function extensionOf(videoKey: string): string {
  const name = videoKey.slice(videoKey.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1
    ? ''
    : name
        .slice(dot + 1)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Name of the downloaded file: the title cleaned of unsafe characters plus the
 * extension of the stored object. Non-ASCII letters are kept; they are encoded
 * by `buildContentDisposition`.
 */
export function buildDownloadFilename(title: string, videoKey: string): string {
  const base = title
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '') // no hidden file and no trailing dot
    .trim()
    .slice(0, MAX_BASE_NAME_LENGTH)
    .trim();
  const extension = extensionOf(videoKey);
  const name = base || FALLBACK_BASE_NAME;
  return extension ? `${name}.${extension}` : name;
}

// RFC 8187: everything outside attr-char is percent-encoded; encodeURIComponent
// leaves a few characters that the RFC does not allow.
const encodeRfc8187 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** ASCII-only rendition for the plain `filename` parameter. */
function toAscii(filename: string): string {
  return filename
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // é -> e
    .replace(/[^\x20-\x7e]/g, '_');
}

/**
 * `Content-Disposition` for a download. The plain `filename` is ASCII; when
 * the name has other characters `filename*` carries it in UTF-8, which is what
 * current browsers use.
 */
export function buildContentDisposition(filename: string): string {
  const ascii = toAscii(filename);
  const header = `attachment; filename="${ascii}"`;
  return ascii === filename
    ? header
    : `${header}; filename*=UTF-8''${encodeRfc8187(filename)}`;
}
