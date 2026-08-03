import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";

import { PublicRoute } from "../auth/public.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ApiException } from "../errors/api.exception.js";
import {
  CreateDocumentPublicLinkDto,
  CreateDocumentUploadDto,
  CreateDocumentUploadResponseDto,
  DocumentDownloadDto,
  DocumentDto,
  DocumentPublicLinkDto,
  PublicDocumentDownloadDto,
} from "./document.dto.js";
import { DocumentsService } from "./documents.service.js";

@ApiTags("Documents")
@Controller("documents")
export class DocumentsController {
  public constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Post("uploads")
  @RequirePermissions("documents:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateDocumentUploadDto })
  @ApiOperation({ operationId: "createDocumentUpload" })
  @ApiCreatedResponse({ type: CreateDocumentUploadResponseDto })
  @Header("Cache-Control", "no-store")
  public createUpload(
    @Body() body: CreateDocumentUploadDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<CreateDocumentUploadResponseDto> {
    return this.documents.createUpload(body, requireIdempotencyKey(idempotencyKey));
  }

  @Post(":id/actions/complete")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("documents:write")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "completeDocumentUpload" })
  @ApiOkResponse({ type: DocumentDto })
  public complete(
    @Param("id", new ParseUUIDPipe({ version: "4" })) documentId: string,
  ): Promise<DocumentDto> {
    return this.documents.complete(documentId);
  }

  @Post(":id/actions/download")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("documents:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "createDocumentDownload" })
  @ApiOkResponse({ type: DocumentDownloadDto })
  @Header("Cache-Control", "no-store")
  public createDownload(
    @Param("id", new ParseUUIDPipe({ version: "4" })) documentId: string,
  ): Promise<DocumentDownloadDto> {
    return this.documents.createDownload(documentId);
  }

  @Post(":id/public-links")
  @RequirePermissions("documents:share")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateDocumentPublicLinkDto })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "createDocumentPublicLink" })
  @ApiCreatedResponse({ type: DocumentPublicLinkDto })
  @Header("Cache-Control", "no-store")
  public createPublicLink(
    @Param("id", new ParseUUIDPipe({ version: "4" })) documentId: string,
    @Body() body: CreateDocumentPublicLinkDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<DocumentPublicLinkDto> {
    return this.documents.createPublicLink(documentId, body, requireIdempotencyKey(idempotencyKey));
  }

  @Post(":id/public-links/:linkId/actions/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("documents:share")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiParam({ format: "uuid", name: "linkId", type: String })
  @ApiOperation({ operationId: "revokeDocumentPublicLink" })
  @ApiNoContentResponse()
  public revokePublicLink(
    @Param("id", new ParseUUIDPipe({ version: "4" })) documentId: string,
    @Param("linkId", new ParseUUIDPipe({ version: "4" })) linkId: string,
  ): Promise<void> {
    return this.documents.revokePublicLink(documentId, linkId);
  }
}

@ApiTags("Public documents")
@PublicRoute()
@Controller("public/document-links")
export class PublicDocumentsController {
  public constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get(":token")
  @ApiParam({ name: "token", type: String })
  @ApiOperation({ operationId: "resolvePublicDocumentLink" })
  @ApiOkResponse({ type: PublicDocumentDownloadDto })
  @Header("Cache-Control", "no-store")
  public resolve(@Param("token") token: string): Promise<PublicDocumentDownloadDto> {
    return this.documents.resolvePublicLink(token);
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required",
    );
  }
  return key;
}
