import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { DocumentTokenService } from "./document-token.service.js";
import { DocumentsController, PublicDocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";

@Module({
  controllers: [DocumentsController, PublicDocumentsController],
  exports: [DocumentsService],
  imports: [IdempotencyModule],
  providers: [DocumentsService, DocumentTokenService],
})
export class DocumentsModule {}
