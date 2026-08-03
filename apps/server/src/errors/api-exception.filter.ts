import {
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { IdempotencyConflictError } from "@ldg/database";
import type { FastifyReply } from "fastify";

import { RequestContextService } from "../context/request-context.service.js";
import { ApiException } from "./api.exception.js";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  public constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
  ) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const correlationId = this.safeCorrelationId();
    const mapped = this.mapException(exception);

    if (mapped.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Request failed (${correlationId}): ${mapped.code}`, stack);
    }

    void reply.status(mapped.status).send({
      error: {
        code: mapped.code,
        correlationId,
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
        message: mapped.message,
      },
    });
  }

  private mapException(exception: unknown): {
    code: string;
    details?: unknown;
    message: string;
    status: number;
  } {
    if (exception instanceof ApiException) {
      return {
        code: exception.code,
        details: exception.details,
        message: exception.message,
        status: exception.getStatus(),
      };
    }

    if (exception instanceof IdempotencyConflictError) {
      return {
        code: "IDEMPOTENCY_CONFLICT",
        message: exception.message,
        status: HttpStatus.CONFLICT,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      return {
        code: status === 400 ? "VALIDATION_FAILED" : "HTTP_ERROR",
        details: typeof response === "object" ? response : undefined,
        message: exception.message,
        status,
      };
    }

    return {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  private safeCorrelationId(): string {
    try {
      return this.context.correlationId();
    } catch {
      return "unavailable";
    }
  }
}
