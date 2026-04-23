import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { successResponse } from '../responses/response-utils';

@Injectable()
export class GlobalResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const event = `${request.method}_${request.route.path}`; // Example event name based on request

    return next.handle().pipe(
      map(
        (data) => successResponse(event, data), // Wrap the original response in successResponse format
      ),
    );
  }
}
