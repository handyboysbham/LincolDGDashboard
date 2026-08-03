import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  IdempotencyConflictError,
  auditEvents,
  documentPublicLinks,
  documents,
  outboxEvents,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { ServerConfigService } from "../config/server-config.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import {
  hashCanonicalPayload,
  IdempotentCommandService,
} from "../idempotency/idempotent-command.service.js";
import {
  ObjectStorageOperationError,
  ObjectStorageService,
  StoredObjectNotFoundError,
  StoredObjectTooLargeError,
} from "../object-storage/object-storage.service.js";
import type {
  CreateDocumentPublicLinkDto,
  CreateDocumentUploadDto,
  CreateDocumentUploadResponseDto,
  DocumentDownloadDto,
  DocumentDto,
  DocumentPublicLinkDto,
  PublicDocumentDownloadDto,
} from "./document.dto.js";
import { DocumentTokenService } from "./document-token.service.js";

type DocumentRecord = typeof documents.$inferSelect;

@Injectable()
export class DocumentsService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(DocumentTokenService) private readonly tokens: DocumentTokenService,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public async createUpload(
    input: CreateDocumentUploadDto,
    idempotencyKey: string,
  ): Promise<CreateDocumentUploadResponseDto> {
    this.assertUpload(input);
    const actor = this.context.actor();
    const originalFilename = sanitizeFilename(input.originalFilename);
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: {
          mediaType: input.mediaType,
          originalFilename,
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
        },
        scope: "documents.create-upload",
      },
      async (transaction) => {
        const id = randomUUID();
        const objectKey = `tenants/${actor.tenantId}/documents/${id}`;
        const [record] = await transaction
          .insert(documents)
          .values({
            createdBy: actor.userId,
            id,
            mediaType: input.mediaType,
            objectKey,
            originalFilename,
            sha256: input.sha256.toLowerCase(),
            sizeBytes: input.sizeBytes,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!record) throw new Error("Pending Document was not created");
        await this.recordChange(transaction, {
          actorUserId: actor.userId,
          after: { status: "pending" },
          commandName: "CreateDocumentUpload",
          documentId: id,
          eventType: "document.pending_created",
          tenantId: actor.tenantId,
        });
        return {
          body: { document: toDocumentDto(record), objectKey },
          status: HttpStatus.CREATED,
        };
      },
    );

    const upload = await this.storage.createUploadUrl({
      mediaType: result.body.document.mediaType,
      objectKey: result.body.objectKey,
    });
    return {
      document: result.body.document,
      upload: {
        expiresAt: upload.expiresAt.toISOString(),
        headers: upload.headers,
        url: upload.url,
      },
    };
  }

  public async complete(documentId: string): Promise<DocumentDto> {
    const actor = this.context.actor();
    const record = await this.findDocument(actor.tenantId, documentId);
    if (record.status === "available") return toDocumentDto(record);
    if (record.status !== "pending") {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "DOCUMENT_UPLOAD_NOT_PENDING",
        "The document upload is not pending",
      );
    }

    let validation;
    try {
      validation = await this.storage.validateObject(record.objectKey);
    } catch (error) {
      if (error instanceof StoredObjectNotFoundError) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "DOCUMENT_UPLOAD_MISSING",
          "The uploaded object is not available yet",
        );
      }
      if (error instanceof StoredObjectTooLargeError) {
        await this.transition(actor.tenantId, actor.userId, record.id, "rejected", "size");
        throw validationFailed();
      }
      if (error instanceof ObjectStorageOperationError) throw storageUnavailable();
      throw error;
    }

    const rejectionReason =
      validation.sizeBytes !== record.sizeBytes
        ? "size"
        : validation.mediaType !== record.mediaType
          ? "media_type"
          : validation.sha256 !== record.sha256
            ? "sha256"
            : !validation.signatureValid
              ? "signature"
              : undefined;
    if (rejectionReason) {
      await this.transition(actor.tenantId, actor.userId, record.id, "rejected", rejectionReason);
      throw validationFailed();
    }

    return this.transition(actor.tenantId, actor.userId, record.id, "available");
  }

  public async createDownload(documentId: string): Promise<DocumentDownloadDto> {
    const actor = this.context.actor();
    const record = await this.findDocument(actor.tenantId, documentId);
    this.assertAvailable(record);
    return this.signDownload(record);
  }

  public async createPublicLink(
    documentId: string,
    input: CreateDocumentPublicLinkDto,
    idempotencyKey: string,
  ): Promise<DocumentPublicLinkDto> {
    const actor = this.context.actor();
    const expiresInSeconds =
      input.expiresInSeconds ??
      this.configuration.value.objectStorage.publicLinkDefaultExpiresSeconds;
    const creationKeyHash = this.tokens.creationKeyHash(idempotencyKey);
    const requestHash = hashCanonicalPayload({ documentId, expiresInSeconds, scope: input.scope });

    const link = await withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(documentPublicLinks)
        .where(
          and(
            eq(documentPublicLinks.tenantId, actor.tenantId),
            eq(documentPublicLinks.creationKeyHash, creationKeyHash),
          ),
        )
        .for("update");
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError(
            "Idempotency key was already used for another public link request",
          );
        }
        return existing;
      }

      const document = await this.findDocumentInTransaction(
        transaction,
        actor.tenantId,
        documentId,
      );
      this.assertAvailable(document);
      const id = randomUUID();
      const token = this.tokens.create({ documentId, linkId: id, tenantId: actor.tenantId });
      const [created] = await transaction
        .insert(documentPublicLinks)
        .values({
          createdBy: actor.userId,
          creationKeyHash,
          documentId,
          expiresAt: new Date(Date.now() + expiresInSeconds * 1_000),
          id,
          requestHash,
          scope: input.scope,
          tenantId: actor.tenantId,
          tokenHash: token.hash,
          updatedBy: actor.userId,
        })
        .returning();
      if (!created) throw new Error("Document public link was not created");
      await this.recordChange(transaction, {
        actorUserId: actor.userId,
        after: { expiresAt: created.expiresAt.toISOString(), scope: created.scope },
        commandName: "CreateDocumentPublicLink",
        documentId,
        eventType: "document.public_link_created",
        metadata: { linkId: id },
        tenantId: actor.tenantId,
      });
      return created;
    });
    const token = this.tokens.create({ documentId, linkId: link.id, tenantId: actor.tenantId });
    return {
      expiresAt: link.expiresAt.toISOString(),
      linkId: link.id,
      scope: "download",
      token: token.token,
    };
  }

  public async revokePublicLink(documentId: string, linkId: string): Promise<void> {
    const actor = this.context.actor();
    await withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const [link] = await transaction
        .select()
        .from(documentPublicLinks)
        .where(
          and(
            eq(documentPublicLinks.tenantId, actor.tenantId),
            eq(documentPublicLinks.documentId, documentId),
            eq(documentPublicLinks.id, linkId),
          ),
        )
        .for("update");
      if (!link) throw publicLinkNotFound();
      if (link.revokedAt) return;
      const revokedAt = new Date();
      await transaction
        .update(documentPublicLinks)
        .set({ revokedAt, updatedBy: actor.userId })
        .where(eq(documentPublicLinks.id, link.id));
      await this.recordChange(transaction, {
        actorUserId: actor.userId,
        after: { revokedAt: revokedAt.toISOString() },
        before: { revokedAt: null },
        commandName: "RevokeDocumentPublicLink",
        documentId,
        eventType: "document.public_link_revoked",
        metadata: { linkId },
        tenantId: actor.tenantId,
      });
    });
  }

  public async resolvePublicLink(token: string): Promise<PublicDocumentDownloadDto> {
    const parsed = this.tokens.parse(token);
    if (!parsed) throw publicLinkInvalid();
    const result = await withTenantTransaction(
      this.database,
      parsed.tenantId,
      async (transaction) => {
        const [link] = await transaction
          .select()
          .from(documentPublicLinks)
          .where(
            and(
              eq(documentPublicLinks.tenantId, parsed.tenantId),
              eq(documentPublicLinks.id, parsed.linkId),
            ),
          );
        if (!link || !this.tokens.matches(parsed.secret, link.tokenHash)) throw publicLinkInvalid();
        if (link.revokedAt) {
          throw new ApiException(
            HttpStatus.GONE,
            "PUBLIC_LINK_REVOKED",
            "This document link has been revoked",
          );
        }
        if (link.expiresAt <= new Date()) {
          throw new ApiException(
            HttpStatus.GONE,
            "PUBLIC_LINK_EXPIRED",
            "This document link has expired",
          );
        }
        const document = await this.findDocumentInTransaction(
          transaction,
          parsed.tenantId,
          link.documentId,
        );
        if (document.status !== "available") {
          throw new ApiException(
            HttpStatus.GONE,
            "DOCUMENT_UNAVAILABLE",
            "This document is no longer available",
          );
        }
        return document;
      },
    );
    const download = await this.signDownload(result);
    return {
      document: toDocumentDto(result),
      expiresAt: download.expiresAt,
      url: download.url,
    };
  }

  private assertUpload(input: CreateDocumentUploadDto): void {
    if (input.sizeBytes > this.configuration.value.objectStorage.maxUploadBytes) {
      throw new ApiException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "DOCUMENT_TOO_LARGE",
        "The document exceeds the configured upload limit",
      );
    }
  }

  private assertAvailable(record: DocumentRecord): void {
    if (record.status !== "available") {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "DOCUMENT_NOT_AVAILABLE",
        "The document is not available for download",
      );
    }
  }

  private async findDocument(tenantId: string, documentId: string): Promise<DocumentRecord> {
    return withTenantTransaction(this.database, tenantId, (transaction) =>
      this.findDocumentInTransaction(transaction, tenantId, documentId),
    );
  }

  private async findDocumentInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<DocumentRecord> {
    const [record] = await transaction
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)));
    if (!record) {
      throw new ApiException(HttpStatus.NOT_FOUND, "DOCUMENT_NOT_FOUND", "Document not found");
    }
    return record;
  }

  private async transition(
    tenantId: string,
    userId: string,
    documentId: string,
    status: "available" | "rejected",
    rejectionReason?: string,
  ): Promise<DocumentDto> {
    return withTenantTransaction(this.database, tenantId, async (transaction) => {
      const [record] = await transaction
        .select()
        .from(documents)
        .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
        .for("update");
      if (!record) {
        throw new ApiException(HttpStatus.NOT_FOUND, "DOCUMENT_NOT_FOUND", "Document not found");
      }
      if (record.status === status || (record.status === "available" && status === "available")) {
        return toDocumentDto(record);
      }
      if (record.status !== "pending") {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "DOCUMENT_UPLOAD_NOT_PENDING",
          "The document upload is not pending",
        );
      }
      const availableAt = status === "available" ? new Date() : null;
      const [updated] = await transaction
        .update(documents)
        .set({ availableAt, status, updatedBy: userId })
        .where(eq(documents.id, documentId))
        .returning();
      if (!updated) throw new Error("Document transition did not update a record");
      await this.recordChange(transaction, {
        actorUserId: userId,
        after: { status },
        before: { status: "pending" },
        commandName: status === "available" ? "CompleteDocumentUpload" : "RejectDocumentUpload",
        documentId,
        eventType: status === "available" ? "document.available" : "document.rejected",
        ...(rejectionReason ? { metadata: { rejectionReason } } : {}),
        tenantId,
      });
      return toDocumentDto(updated);
    });
  }

  private async signDownload(record: DocumentRecord): Promise<DocumentDownloadDto> {
    const signed = await this.storage.createDownloadUrl({
      filename: record.originalFilename,
      mediaType: record.mediaType,
      objectKey: record.objectKey,
    });
    return { expiresAt: signed.expiresAt.toISOString(), url: signed.url };
  }

  private async recordChange(
    transaction: TenantTransaction,
    input: {
      actorUserId: string;
      after: unknown;
      before?: unknown;
      commandName: string;
      documentId: string;
      eventType: string;
      metadata?: Record<string, unknown>;
      tenantId: string;
    },
  ): Promise<void> {
    const eventId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: input.actorUserId,
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      correlationId: this.context.correlationId(),
      entityId: input.documentId,
      entityType: "Document",
      eventType: input.eventType,
      id: eventId,
      metadata: input.metadata ?? {},
      tenantId: input.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.documentId,
      aggregateType: "Document",
      createdBy: input.actorUserId,
      eventType: input.eventType,
      payload: {
        documentId: input.documentId,
        eventId,
        ...(input.metadata ?? {}),
      },
      tenantId: input.tenantId,
      updatedBy: input.actorUserId,
    });
  }
}

function toDocumentDto(record: DocumentRecord): DocumentDto {
  if (
    record.sizeBytes === null ||
    (record.status !== "pending" && record.status !== "available" && record.status !== "rejected")
  ) {
    throw new Error("Document record cannot be represented by this API contract");
  }
  return {
    id: record.id,
    mediaType: record.mediaType,
    originalFilename: record.originalFilename,
    sizeBytes: record.sizeBytes,
    status: record.status,
  };
}

function sanitizeFilename(value: string): string {
  const filename = value.replaceAll("\\", "/").split("/").at(-1)?.trim();
  if (!filename || filename === "." || filename === ".." || hasControlCharacter(filename)) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "INVALID_DOCUMENT_FILENAME",
      "The document filename is invalid",
    );
  }
  return filename;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validationFailed(): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "DOCUMENT_VALIDATION_FAILED",
    "The uploaded document failed validation",
  );
}

function storageUnavailable(): ApiException {
  return new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    "OBJECT_STORAGE_UNAVAILABLE",
    "Object storage is temporarily unavailable",
  );
}

function publicLinkNotFound(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, "PUBLIC_LINK_NOT_FOUND", "Public link not found");
}

function publicLinkInvalid(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    "PUBLIC_LINK_INVALID",
    "This document link is invalid",
  );
}
