export class BaseResponse<T = any> {
  success: boolean;
  uuid: string;
  event: string;
  data?: T;
  error?: {
    message: string;
    code: string;
    stack?: string;
    fields?: any[];
  };
}
