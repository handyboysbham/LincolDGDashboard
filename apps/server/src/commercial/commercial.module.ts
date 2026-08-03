import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { IntakeModule } from "../intake/intake.module.js";
import {
  EstimatesController,
  PricingController,
  PublicQuotesController,
  QuotesController,
} from "./commercial.controller.js";
import { EstimatesService } from "./estimates.service.js";
import { PricingService } from "./pricing.service.js";
import { QuoteTokenService } from "./quote-token.service.js";
import { QuotesService } from "./quotes.service.js";

@Module({
  controllers: [PricingController, EstimatesController, QuotesController, PublicQuotesController],
  imports: [IdempotencyModule, IntakeModule],
  providers: [PricingService, EstimatesService, QuoteTokenService, QuotesService],
})
export class CommercialModule {}
