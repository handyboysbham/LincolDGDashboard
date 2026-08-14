import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { DocumentTokenService } from "./document-token.service.js";
import { DocumentTransferTokenService } from "./document-transfer-token.service.js";
import {
  DocumentsController,
  PublicDocumentsController,
  PublicDocumentTransfersController,
} from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";

@Module({
  controllers: [DocumentsController, PublicDocumentsController, PublicDocumentTransfersController],
  exports: [DocumentsService],
  imports: [IdempotencyModule],
  providers: [DocumentsService, DocumentTokenService, DocumentTransferTokenService],
})
export class DocumentsModule {}
