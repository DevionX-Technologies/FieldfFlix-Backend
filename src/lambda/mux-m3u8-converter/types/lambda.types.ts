import { Context } from 'aws-lambda';
import {
  M3u8ConversionRequest,
  M3u8ConversionResponse,
} from '../interfaces/converter.interface';

export type LambdaHandler = (
  event: M3u8ConversionRequest,
  context: Context,
) => Promise<M3u8ConversionResponse>;

export interface LambdaErrorResponse extends M3u8ConversionResponse {
  success: false;
  error: string;
  message: string;
  requestId?: string;
}
