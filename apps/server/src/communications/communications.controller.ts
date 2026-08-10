import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ApiException } from "../errors/api.exception.js";
import {
  CreateNotificationTemplateDto,
  CreateProjectPublicLinkDto,
  CommunicationOperationsDto,
  CommunicationRetryDto,
  NotificationDeliveryDto,
  NotificationDeliveryListDto,
  NotificationPreferenceDto,
  NotificationPreferenceListDto,
  NotificationTemplateDto,
  NotificationTemplateListDto,
  ProjectPublicLinkDto,
  PublicProjectDto,
  QueueNotificationDto,
  QueuedNotificationDto,
  UpsertNotificationPreferenceDto,
} from "./communications.dto.js";
import { CommunicationsService } from "./communications.service.js";
import { CustomerProjectService } from "./customer-project.service.js";
import { PublicRoute } from "../auth/public.decorator.js";

@ApiTags("Communications")
@Controller("notification-templates")
export class NotificationTemplatesController {
  public constructor(
    @Inject(CommunicationsService) private readonly communications: CommunicationsService,
  ) {}

  @Get()
  @RequirePermissions("communications:read")
  @ApiOperation({ operationId: "listNotificationTemplates" })
  @ApiOkResponse({ type: NotificationTemplateListDto })
  public list(): Promise<NotificationTemplateListDto> {
    return this.communications.listTemplates();
  }

  @Post()
  @RequirePermissions("communications:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateNotificationTemplateDto })
  @ApiOperation({ operationId: "createNotificationTemplate" })
  @ApiCreatedResponse({ type: NotificationTemplateDto })
  public create(
    @Body() body: CreateNotificationTemplateDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<NotificationTemplateDto> {
    return this.communications.createTemplate(body, requireIdempotencyKey(key));
  }

  @Post(":id/actions/publish")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communications:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiOperation({ operationId: "publishNotificationTemplate" })
  @ApiOkResponse({ type: NotificationTemplateDto })
  public publish(
    @Param("id", new ParseUUIDPipe({ version: "4" })) templateId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<NotificationTemplateDto> {
    return this.communications.publishTemplate(templateId, requireIdempotencyKey(key));
  }
}

@ApiTags("Communications")
@Controller("customers/:customerId/notification-preferences")
export class NotificationPreferencesController {
  public constructor(
    @Inject(CommunicationsService) private readonly communications: CommunicationsService,
  ) {}

  @Get()
  @RequirePermissions("communications:read")
  @ApiParam({ format: "uuid", name: "customerId" })
  @ApiOperation({ operationId: "listNotificationPreferences" })
  @ApiOkResponse({ type: NotificationPreferenceListDto })
  public list(
    @Param("customerId", new ParseUUIDPipe({ version: "4" })) customerId: string,
  ): Promise<NotificationPreferenceListDto> {
    return this.communications.listPreferences(customerId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communications:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "customerId" })
  @ApiBody({ type: UpsertNotificationPreferenceDto })
  @ApiOperation({ operationId: "setNotificationPreference" })
  @ApiOkResponse({ type: NotificationPreferenceDto })
  public set(
    @Param("customerId", new ParseUUIDPipe({ version: "4" })) customerId: string,
    @Body() body: UpsertNotificationPreferenceDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<NotificationPreferenceDto> {
    return this.communications.setPreference(customerId, body, requireIdempotencyKey(key));
  }
}

@ApiTags("Communications")
@Controller("notifications")
export class NotificationsController {
  public constructor(
    @Inject(CommunicationsService) private readonly communications: CommunicationsService,
  ) {}

  @Get()
  @RequirePermissions("communications:read")
  @ApiQuery({ format: "uuid", name: "customerAccountId", required: false })
  @ApiQuery({ format: "uuid", name: "projectId", required: false })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ maximum: 100, minimum: 1, name: "limit", required: false, type: Number })
  @ApiOperation({ operationId: "listNotificationDeliveries" })
  @ApiOkResponse({ type: NotificationDeliveryListDto })
  public list(
    @Query("customerAccountId") customerAccountId?: string,
    @Query("projectId") projectId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<NotificationDeliveryListDto> {
    return this.communications.listDeliveries({
      ...(customerAccountId ? { customerAccountId } : {}),
      limit: parseLimit(limit),
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
    });
  }

  @Get(":id")
  @RequirePermissions("communications:read")
  @ApiParam({ format: "uuid", name: "id" })
  @ApiOperation({ operationId: "getNotificationDelivery" })
  @ApiOkResponse({ type: NotificationDeliveryDto })
  public get(
    @Param("id", new ParseUUIDPipe({ version: "4" })) deliveryId: string,
  ): Promise<NotificationDeliveryDto> {
    return this.communications.getDelivery(deliveryId);
  }

  @Post(":id/actions/retry")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communications:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiOperation({ operationId: "retryNotificationDelivery" })
  @ApiOkResponse({ type: CommunicationRetryDto })
  public retry(
    @Param("id", new ParseUUIDPipe({ version: "4" })) deliveryId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<CommunicationRetryDto> {
    return this.communications.retryDelivery(deliveryId, requireIdempotencyKey(key));
  }

  @Post()
  @RequirePermissions("communications:send")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: QueueNotificationDto })
  @ApiOperation({ operationId: "queueNotification" })
  @ApiCreatedResponse({ type: QueuedNotificationDto })
  public queue(
    @Body() body: QueueNotificationDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<QueuedNotificationDto> {
    return this.communications.queueNotification(body, requireIdempotencyKey(key));
  }
}

@ApiTags("Communications")
@Controller("communication-operations")
export class CommunicationOperationsController {
  public constructor(
    @Inject(CommunicationsService) private readonly communications: CommunicationsService,
  ) {}

  @Get()
  @RequirePermissions("communications:read")
  @ApiOperation({ operationId: "getCommunicationOperations" })
  @ApiOkResponse({ type: CommunicationOperationsDto })
  public get(): Promise<CommunicationOperationsDto> {
    return this.communications.getOperations();
  }

  @Post("outbox/:id/actions/retry")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communications:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiOperation({ operationId: "retryCommunicationDeadLetter" })
  @ApiOkResponse({ type: CommunicationRetryDto })
  public retryDeadLetter(
    @Param("id", new ParseUUIDPipe({ version: "4" })) eventId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<CommunicationRetryDto> {
    return this.communications.retryDeadLetter(eventId, requireIdempotencyKey(key));
  }

  @Post("scheduled-jobs/:id/actions/retry")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communications:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiOperation({ operationId: "retryCommunicationReminder" })
  @ApiOkResponse({ type: CommunicationRetryDto })
  public retryReminder(
    @Param("id", new ParseUUIDPipe({ version: "4" })) reminderId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<CommunicationRetryDto> {
    return this.communications.retryReminder(reminderId, requireIdempotencyKey(key));
  }
}

@ApiTags("Communications")
@Controller("projects/:projectId/public-links")
export class CustomerProjectLinksController {
  public constructor(
    @Inject(CustomerProjectService) private readonly customerProjects: CustomerProjectService,
  ) {}

  @Post()
  @RequirePermissions("communications:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "projectId" })
  @ApiBody({ type: CreateProjectPublicLinkDto })
  @ApiOperation({ operationId: "createCustomerProjectLink" })
  @ApiCreatedResponse({ type: ProjectPublicLinkDto })
  public create(
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Body() body: CreateProjectPublicLinkDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ProjectPublicLinkDto> {
    return this.customerProjects.createPublicLink(projectId, body, requireIdempotencyKey(key));
  }

  @Post(":linkId/actions/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("communications:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "projectId" })
  @ApiParam({ format: "uuid", name: "linkId" })
  @ApiOperation({ operationId: "revokeCustomerProjectLink" })
  public revoke(
    @Param("projectId", new ParseUUIDPipe({ version: "4" })) projectId: string,
    @Param("linkId", new ParseUUIDPipe({ version: "4" })) linkId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<void> {
    return this.customerProjects.revokePublicLink(projectId, linkId, requireIdempotencyKey(key));
  }
}

@ApiTags("Public projects")
@PublicRoute()
@Controller("public/projects")
export class PublicCustomerProjectsController {
  public constructor(
    @Inject(CustomerProjectService) private readonly customerProjects: CustomerProjectService,
  ) {}

  @Get(":token")
  @Header("Cache-Control", "no-store")
  @ApiParam({ name: "token", type: String })
  @ApiOperation({ operationId: "getPublicCustomerProject" })
  @ApiOkResponse({ type: PublicProjectDto })
  public get(@Param("token") token: string): Promise<PublicProjectDto> {
    return this.customerProjects.resolvePublic(token);
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) {
    throw new ApiException(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required",
    );
  }
  return key;
}

function parseLimit(value: string | undefined): number {
  if (!value) return 50;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 50;
}
