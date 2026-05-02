import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let httpStatus: HttpStatus;
    let message: string;
    let errorName: string | undefined;
    let stack: string | undefined;

    /** Extra keys from `HttpException` payloads (e.g. 409 start conflict) for clients. */
    const extraExceptionFields: Record<string, string> = {};

    if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const er = exceptionResponse as Record<string, unknown>;
        message =
          (typeof er.message === 'string'
            ? er.message
            : Array.isArray(er.message)
              ? er.message.join(', ')
              : 'HttpException occurred') || 'HttpException occurred';
        errorName = (er.error as string) || exception.name;
        for (const key of ['existingRecordingId', 'cameraId'] as const) {
          if (typeof er[key] === 'string' && er[key].length > 0) {
            extraExceptionFields[key] = er[key] as string;
          }
        }
      } else {
        message = 'HttpException occurred';
      }
      errorName = errorName || exception.name;
      stack = exception.stack;
    } else if (exception instanceof Error) {
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message || 'Internal server error';
      errorName = exception.name || 'Error';
      stack = exception.stack;
    } else {
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unknown and unexpected error occurred';
      errorName = 'UnknownError';
    }

    const responseBody = {
      statusCode: httpStatus,
      message: message,
      error: errorName,
      path: request.url,
      timestamp: new Date().toISOString(),
      ...extraExceptionFields,
    };

    if (process.env.ENVIRONMENT === 'development' && stack) {
      (responseBody as Record<string, unknown>).stack = stack;
    }

    this.logger.error(
      `[GlobalExceptionFilter] Status: ${httpStatus} Error: ${errorName} Message: ${message} Path: ${request.url}`,
      stack,
    );

    if (response.headersSent) {
      this.logger.warn(
        `[GlobalExceptionFilter] Headers already sent for ${request.method} ${request.url}. Cannot send JSON error response. Terminating response.`,
      );
      if (!response.writableEnded) {
        response.end();
      }
      return;
    }

    response.status(httpStatus).json(responseBody);
  }
}
