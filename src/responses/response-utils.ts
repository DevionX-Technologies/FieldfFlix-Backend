import { v4 as uuidv4 } from 'uuid';
import { BaseResponse } from './base-response';

export function successResponse<T>(event: string, data: T): BaseResponse<T> {
  return {
    success: true,
    uuid: uuidv4(),
    event,
    data,
  };
}

export function errorResponse(
  event: string,
  message: string,
  code: string,
  stack?: string,
  fields?: any[],
): BaseResponse {
  return {
    success: false,
    uuid: uuidv4(),
    event,
    error: {
      message,
      code,
      stack: stack || '',
      fields: fields || [],
    },
  };
}
