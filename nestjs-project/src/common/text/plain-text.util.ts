import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';

// Control characters other than line feed (\n) and tab (\t). Carriage returns
// never reach this check: line breaks are normalised to \n first.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** `\r\n` and lone `\r` become `\n`; the text is otherwise kept as is. */
export function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Plain text: no control characters besides line feed and tab. */
export function isPlainText(value: string): boolean {
  return !FORBIDDEN_CONTROL_CHARACTERS.test(value);
}

/**
 * Normalises line breaks (and trims, when asked) before validation, so the
 * length limits apply to what is stored. Non-string values pass through
 * untouched for the type validators to reject.
 */
export function NormalizePlainText(options: { trim?: boolean } = {}) {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const normalized = normalizeLineBreaks(value);
    return options.trim ? normalized.trim() : normalized;
  });
}

/** Rejects control characters other than `\n` and `\t`. Text is never HTML. */
export function IsPlainText(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isPlainText',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be plain text without control characters`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' || isPlainText(value),
      },
    });
  };
}
