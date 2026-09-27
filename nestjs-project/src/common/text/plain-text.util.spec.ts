import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  IsPlainText,
  isPlainText,
  NormalizePlainText,
  normalizeLineBreaks,
} from './plain-text.util';

class Sample {
  @NormalizePlainText({ trim: true })
  @IsPlainText()
  title: unknown;

  @NormalizePlainText()
  @IsPlainText()
  body: unknown;
}

const build = (input: Record<string, unknown>) =>
  plainToInstance(Sample, input);

describe('plain text', () => {
  it('normalizes CRLF and lone CR to LF', () => {
    expect(normalizeLineBreaks('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('accepts line feed and tab, and HTML as plain text', () => {
    expect(isPlainText('line 1\n\tline 2 <b>not html</b>')).toBe(true);
  });

  it.each(['\u0000', '\u001b[31m', '\u0007', '\u007f'])(
    'rejects the control character %j',
    (value) => {
      expect(isPlainText(`a${value}b`)).toBe(false);
    },
  );

  it('trims only the fields that ask for it and normalizes line breaks', () => {
    const sample = build({ title: '  Title  ', body: '  a\r\nb  ' });

    expect(sample.title).toBe('Title');
    expect(sample.body).toBe('  a\nb  ');
    expect(validateSync(sample)).toHaveLength(0);
  });

  it('reports a control character through the validator', () => {
    const errors = validateSync(build({ title: 'ok', body: 'bad\u0000' }));

    expect(errors.map((error) => error.property)).toEqual(['body']);
  });

  it('leaves non-string values for the type validators', () => {
    const sample = build({ title: 42, body: null });

    expect(sample.title).toBe(42);
    expect(sample.body).toBeNull();
  });
});
