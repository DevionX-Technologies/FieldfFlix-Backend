import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

/**
 * A guard to protect endpoints by validating an API key in the request headers.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Determines if the current request is authorized based on the provided API key.
   * @param context The execution context of the current request.
   * @returns A boolean indicating if the request is authorized.
   * @throws UnauthorizedException if the API key is missing or invalid.
   */
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];
    const validApiKey = this.configService.get<string>('LAMBDA_API_KEY');

    if (apiKey !== validApiKey) {
      throw new UnauthorizedException('Invalid API Key');
    }

    return true;
  }
}
