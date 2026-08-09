import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { FinancialCompletionController } from "./financial-completion.controller.js";
import { FinancialCompletionService } from "./financial-completion.service.js";
import { InvoicesController, PublicInvoicesController } from "./finance.controller.js";
import { InvoiceTokenService } from "./invoice-token.service.js";
import { InvoicesService } from "./invoices.service.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { RefundsController } from "./refunds.controller.js";
import { RefundsService } from "./refunds.service.js";

@Module({
  controllers: [
    FinancialCompletionController,
    InvoicesController,
    PaymentsController,
    PublicInvoicesController,
    RefundsController,
  ],
  imports: [IdempotencyModule],
  providers: [
    FinancialCompletionService,
    InvoicesService,
    InvoiceTokenService,
    PaymentsService,
    RefundsService,
  ],
})
export class FinanceModule {}
