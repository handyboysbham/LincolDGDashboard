import { HttpException } from "@nestjs/common";

export class ApiException extends HttpException {
  public constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, status);
  }
}
