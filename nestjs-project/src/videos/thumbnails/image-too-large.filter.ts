import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ImageTooLargeException } from '../../common/exceptions/domain.exception';
import { DomainExceptionFilter } from '../../common/filters/domain-exception.filter';

/**
 * Multer cuts an upload over `limits.fileSize` while it streams in and raises
 * PayloadTooLargeException; on the thumbnail route that is IMAGE_TOO_LARGE,
 * answered with the project's error envelope.
 */
@Catch(PayloadTooLargeException)
export class ImageTooLargeFilter implements ExceptionFilter {
  private readonly domainFilter = new DomainExceptionFilter();

  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    this.domainFilter.catch(new ImageTooLargeException(), host);
  }
}
