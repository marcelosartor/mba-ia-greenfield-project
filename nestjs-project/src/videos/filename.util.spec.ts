import {
  buildContentDisposition,
  buildDownloadFilename,
} from './filename.util';

const KEY = 'channel-1/video-1/source.mp4';

describe('buildDownloadFilename', () => {
  it('should join the title and the extension of the stored object', () => {
    expect(buildDownloadFilename('Holiday in Lisbon', KEY)).toBe(
      'Holiday in Lisbon.mp4',
    );
  });

  it.each([
    ['Meu vídeo: teste/1', 'Meu vídeo teste 1.mp4'],
    ['a\\b/c:d*e?f"g<h>i|j', 'a b c d e f g h i j.mp4'],
    ['  many   spaces  ', 'many spaces.mp4'],
    ['line\nbreak\r\nand\ttab', 'line break and tab.mp4'],
    ['null\u0000byte', 'null byte.mp4'],
  ])('should clean the unsafe characters of %p', (title, expected) => {
    expect(buildDownloadFilename(title, KEY)).toBe(expected);
  });

  it('should keep non-ASCII letters for the encoded parameter', () => {
    expect(buildDownloadFilename('Férias em São Paulo 日本', KEY)).toBe(
      'Férias em São Paulo 日本.mp4',
    );
  });

  it.each([
    ['..', 'video.mp4'],
    ['.hidden', 'hidden.mp4'],
    ['trailing...', 'trailing.mp4'],
    ['', 'video.mp4'],
    ['///', 'video.mp4'],
  ])(
    'should never produce a hidden or empty name for %p',
    (title, expected) => {
      expect(buildDownloadFilename(title, KEY)).toBe(expected);
    },
  );

  it('should cap a very long title', () => {
    const name = buildDownloadFilename('x'.repeat(500), KEY);

    expect(name).toBe(`${'x'.repeat(100)}.mp4`);
  });

  it.each([
    ['channel/video/source.MOV', 'clip.mov'],
    ['channel/video/source.webm', 'clip.webm'],
    ['channel/video/source', 'clip'],
    ['channel/video/source.m$p4', 'clip.mp4'],
  ])('should take the extension from the key %p', (key, expected) => {
    expect(buildDownloadFilename('clip', key)).toBe(expected);
  });
});

describe('buildContentDisposition', () => {
  it('should send a plain ASCII name as a single filename parameter', () => {
    expect(buildContentDisposition('Holiday.mp4')).toBe(
      'attachment; filename="Holiday.mp4"',
    );
  });

  it('should add an encoded filename* when the name has non-ASCII characters', () => {
    const header = buildContentDisposition('Meu vídeo teste 1.mp4');

    expect(header).toBe(
      `attachment; filename="Meu video teste 1.mp4"; filename*=UTF-8''Meu%20v%C3%ADdeo%20teste%201.mp4`,
    );
  });

  it('should replace what has no ASCII equivalent in the plain name', () => {
    const header = buildContentDisposition('日本.mp4');

    expect(header).toContain('filename="__.mp4"');
    expect(header).toContain("filename*=UTF-8''%E6%97%A5%E6%9C%AC.mp4");
  });

  it('should percent-encode the characters RFC 8187 does not allow', () => {
    const header = buildContentDisposition("it's (é) *.mp4");

    expect(header).toContain(
      "filename*=UTF-8''it%27s%20%28%C3%A9%29%20%2A.mp4",
    );
  });

  it('should leave nothing that could break the header out of the plain name', () => {
    const header = buildContentDisposition('Vídeo.mp4');
    const plain = /filename="([^"]*)"/.exec(header)?.[1] ?? '';

    expect(plain).toMatch(/^[\x20-\x7e]*$/);
    expect(header).not.toMatch(/[\r\n]/);
  });
});
