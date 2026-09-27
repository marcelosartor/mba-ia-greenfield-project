import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BEARER_PREFIX } from '../auth.constants';
import { JwtPayload } from '../auth.types';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      targets,
    );
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user: unknown }>();

    const isOptional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      targets,
    );
    if (isOptional) {
      // Only the Authorization header counts: never a query string or cookie.
      const payload = await this.verify(request.headers?.authorization);
      if (payload) request.user = payload;
      return true;
    }

    const payload = await this.verify(request.headers?.authorization);
    if (!payload) {
      throw new UnauthorizedException();
    }
    request.user = payload;
    return true;
  }

  private async verify(
    authHeader: string | undefined,
  ): Promise<JwtPayload | null> {
    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
      return null;
    }
    const token = authHeader.slice(BEARER_PREFIX.length);
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      return null;
    }
  }
}
