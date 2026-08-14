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
  Put,
  Res,
  StreamableFile,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiConsumes,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

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
  supportedDocumentMediaTypes,
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

@ApiTags("Public document transfers")
@PublicRoute()
@Controller("public")
export class PublicDocumentTransfersController {
  public constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Put("document-uploads/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiConsumes(...supportedDocumentMediaTypes)
  @ApiHeader({ name: "X-Document-Upload-Token", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ schema: { format: "binary", type: "string" } })
  @ApiOperation({ operationId: "uploadDocumentBytes" })
  @ApiNoContentResponse()
  public upload(
    @Param("id", new ParseUUIDPipe({ version: "4" })) documentId: string,
    @Headers("x-document-upload-token") token: string | undefined,
    @Body() body: Buffer,
  ): Promise<void> {
    return this.documents.uploadTransfer(documentId, requireTransferToken(token), body);
  }

  @Get("document-downloads/:token")
  @ApiParam({ name: "token", type: String })
  @ApiOperation({ operationId: "downloadDocumentBytes" })
  @ApiOkResponse({ schema: { format: "binary", type: "string" } })
  @Header("Cache-Control", "private, no-store")
  public async download(
    @Param("token") token: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<StreamableFile> {
    const result = await this.documents.downloadTransfer(token);
    response.header("Content-Disposition", contentDisposition(result.filename));
    response.header("Content-Type", result.mediaType);
    response.header("X-Content-Type-Options", "nosniff");
    return new StreamableFile(result.bytes);
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

function requireTransferToken(value: string | undefined): string {
  const token = value?.trim();
  if (!token || token.length > 256) throw transferTokenInvalid();
  return token;
}

function transferTokenInvalid(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    "DOCUMENT_TRANSFER_INVALID",
    "This document transfer is invalid",
  );
}

function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replaceAll("'", "%27");
  return `attachment; filename*=UTF-8''${encoded}`;
}
