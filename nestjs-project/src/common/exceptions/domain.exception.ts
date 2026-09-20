export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
    /** Extra response headers the error carries (e.g. `Content-Range`). */
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class StorageUnavailableException extends DomainException {
  constructor() {
    super('STORAGE_UNAVAILABLE', 502, 'Object storage is unavailable');
  }
}

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Authenticated user has no channel');
  }
}

export class VideoTooLargeException extends DomainException {
  constructor() {
    super('VIDEO_TOO_LARGE', 413, 'Video exceeds the maximum allowed size');
  }
}

export class UnsupportedVideoFormatException extends DomainException {
  constructor() {
    super(
      'UNSUPPORTED_VIDEO_FORMAT',
      415,
      'Video extension or content type is not supported',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoAccessDeniedException extends DomainException {
  constructor() {
    super(
      'VIDEO_ACCESS_DENIED',
      403,
      'Only the owner of the video can manage its upload',
    );
  }
}

export class UploadAlreadyCompletedException extends DomainException {
  constructor() {
    super('UPLOAD_ALREADY_COMPLETED', 409, 'Upload was already completed');
  }
}

export class UploadIncompleteException extends DomainException {
  constructor() {
    super(
      'UPLOAD_INCOMPLETE',
      409,
      'Uploaded parts are missing, out of sequence or have an unexpected size',
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready yet');
  }
}

export class InvalidRangeException extends DomainException {
  constructor(totalBytes: number) {
    super('INVALID_RANGE', 416, 'Requested range is not satisfiable', {
      'Content-Range': `bytes */${totalBytes}`,
    });
  }
}
