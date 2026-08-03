import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  allocateBusinessNumber,
  auditEvents,
  outboxEvents,
  quoteAcceptances,
  quoteDeliveries,
  quoteLineItems,
  quotePublicLinks,
  quotes,
  quoteTerms,
  quoteVersions,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import {
  IdempotentCommandService,
  hashCanonicalPayload,
} from "../idempotency/idempotent-command.service.js";
import { IntakeService } from "../intake/intake.service.js";
import { ProjectsService } from "../operations/projects.service.js";
import type {
  AcceptQuoteDto,
  AcceptQuoteResponseDto,
  DeclineQuoteDto,
  PublicQuoteDto,
  QuoteListResponseDto,
  QuoteVersionDto,
  SendQuoteDto,
  SendQuoteResponseDto,
} from "./commercial.dto.js";
import { EstimatesService, type EstimateVersionContext } from "./estimates.service.js";
import { QuoteTokenService, type ParsedQuoteToken } from "./quote-token.service.js";

interface Actor {
  tenantId: string;
  userId: string;
}
type QuoteRecord = typeof quotes.$inferSelect;
type QuoteVersionRecord = typeof quoteVersions.$inferSelect;

interface QuoteVersionContext {
  lineItems: (typeof quoteLineItems.$inferSelect)[];
  quote: QuoteRecord;
  terms: (typeof quoteTerms.$inferSelect)[];
  version: QuoteVersionRecord;
}

@Injectable()
export class QuotesService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(EstimatesService) private readonly estimates: EstimatesService,
    @Inject(IntakeService) private readonly intake: IntakeService,
    @Inject(QuoteTokenService) private readonly tokens: QuoteTokenService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  public async list(): Promise<QuoteListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const parents = await transaction
        .select()
        .from(quotes)
        .where(eq(quotes.tenantId, actor.tenantId))
        .orderBy(desc(quotes.updatedAt))
        .limit(100);
      const items: QuoteListResponseDto["items"] = [];
      for (const quote of parents) {
        const [version] = await transaction
          .select()
          .from(quoteVersions)
          .where(
            and(eq(quoteVersions.tenantId, actor.tenantId), eq(quoteVersions.quoteId, quote.id)),
          )
          .orderBy(desc(quoteVersions.versionNumber))
          .limit(1);
        if (!version) continue;
        items.push({
          customerName: snapshotString(version.customerSnapshot, "displayName"),
          expiresAt: version.expiresAt?.toISOString() ?? null,
          quoteId: quote.id,
          quoteNumber: quote.quoteNumber,
          quoteVersionId: version.id,
          serviceType: snapshotString(version.customerSnapshot, "serviceType"),
          status: version.status,
          totalCents: version.totalCents,
          updatedAt: quote.updatedAt.toISOString(),
          versionNumber: version.versionNumber,
        });
      }
      return { items };
    });
  }

  public async get(quoteId: string): Promise<QuoteVersionDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const context = await this.getLatestQuoteVersion(transaction, actor.tenantId, quoteId);
      return this.toStaffDto(transaction, context);
    });
  }

  public async createFromEstimate(
    estimateVersionId: string,
    idempotencyKey: string,
  ): Promise<QuoteVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { estimateVersionId },
        scope: "quotes.create-from-estimate",
      },
      async (transaction) => {
        const estimate = await this.estimates.getVersionContext(
          transaction,
          actor.tenantId,
          estimateVersionId,
          true,
        );
        if (estimate.version.status === "quote_generated") {
          const existing = await this.findVersionByEstimate(
            transaction,
            actor.tenantId,
            estimateVersionId,
          );
          if (existing) {
            return {
              body: await this.toStaffDto(transaction, existing),
              status: HttpStatus.OK,
            };
          }
        }
        if (estimate.version.status !== "approved") {
          throw invalidState(
            "ESTIMATE_NOT_APPROVED",
            "Only an approved Estimate Version can generate a Quote",
          );
        }
        const [existingQuote] = await transaction
          .select()
          .from(quotes)
          .where(
            and(eq(quotes.tenantId, actor.tenantId), eq(quotes.estimateId, estimate.estimate.id)),
          )
          .for("update");
        let quote = existingQuote;
        let versionNumber = 1;
        if (quote) {
          const latest = await this.getLatestQuoteVersion(
            transaction,
            actor.tenantId,
            quote.id,
            true,
          );
          if (latest.version.status === "accepted") {
            throw invalidState(
              "QUOTE_ALREADY_ACCEPTED",
              "An accepted Quote cannot receive another commercial version",
            );
          }
          if (latest.version.status !== "superseded") {
            await this.supersedeVersion(transaction, actor, latest);
          }
          versionNumber = latest.version.versionNumber + 1;
        } else {
          const quoteNumber = await allocateBusinessNumber(transaction, {
            entityType: "quote",
            prefix: "QTE",
            tenantId: actor.tenantId,
            year: new Date().getUTCFullYear(),
          });
          [quote] = await transaction
            .insert(quotes)
            .values({
              createdBy: actor.userId,
              customerAccountId: estimate.lead.customer.id,
              estimateId: estimate.estimate.id,
              leadId: estimate.lead.id,
              ownerUserId: estimate.lead.ownerUserId,
              primaryContactId: estimate.lead.primaryContact.id,
              quoteNumber,
              serviceLocationId: estimate.lead.serviceLocation.id,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
        }
        if (!quote) throw new Error("Quote was not created");
        const context = await this.createQuoteVersion(
          transaction,
          actor,
          quote,
          estimate,
          versionNumber,
        );
        await this.estimates.markQuoteGenerated(
          transaction,
          actor,
          estimateVersionId,
          context.version.id,
        );
        await this.recordChange(transaction, actor, {
          after: { status: "draft", versionNumber },
          commandName: "CreateQuoteVersion",
          entityId: context.version.id,
          entityType: "QuoteVersion",
          eventType: "quote.version_created",
          metadata: { estimateVersionId, quoteId: quote.id },
        });
        return {
          body: await this.toStaffDto(transaction, context),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async approve(quoteVersionId: string, idempotencyKey: string): Promise<QuoteVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { quoteVersionId },
        scope: "quotes.approve-version",
      },
      async (transaction) => {
        const context = await this.getQuoteVersion(
          transaction,
          actor.tenantId,
          quoteVersionId,
          true,
        );
        if (context.version.status === "ready_to_send") {
          return { body: await this.toStaffDto(transaction, context), status: HttpStatus.OK };
        }
        if (context.version.status !== "draft") {
          throw invalidState(
            "QUOTE_VERSION_NOT_DRAFT",
            "Only a draft Quote Version can be approved",
          );
        }
        const approvedAt = new Date();
        await transaction
          .update(quoteVersions)
          .set({
            approvedAt,
            approvedBy: actor.userId,
            status: "ready_to_send",
            updatedBy: actor.userId,
          })
          .where(
            and(eq(quoteVersions.tenantId, actor.tenantId), eq(quoteVersions.id, quoteVersionId)),
          );
        await this.updateQuoteStatus(transaction, actor, context.quote.id, "ready_to_send");
        await this.recordChange(transaction, actor, {
          after: { status: "ready_to_send" },
          before: { status: context.version.status },
          commandName: "ApproveQuoteVersion",
          entityId: quoteVersionId,
          entityType: "QuoteVersion",
          eventType: "quote.version_approved",
          metadata: { quoteId: context.quote.id },
        });
        return {
          body: await this.toStaffDto(
            transaction,
            await this.getQuoteVersion(transaction, actor.tenantId, quoteVersionId),
          ),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async send(
    quoteVersionId: string,
    input: SendQuoteDto,
    idempotencyKey: string,
  ): Promise<SendQuoteResponseDto> {
    this.assertRecipient(input);
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const creationKeyHash = this.tokens.creationKeyHash(idempotencyKey);
      const requestHash = hashCanonicalPayload({ input, quoteVersionId });
      const [existing] = await transaction
        .select()
        .from(quotePublicLinks)
        .where(
          and(
            eq(quotePublicLinks.tenantId, actor.tenantId),
            eq(quotePublicLinks.creationKeyHash, creationKeyHash),
          ),
        )
        .for("update");
      if (existing) {
        if (existing.requestHash !== requestHash || existing.quoteVersionId !== quoteVersionId) {
          throw conflict(
            "IDEMPOTENCY_KEY_CONFLICT",
            "Idempotency key was already used for another Quote send request",
          );
        }
        const context = await this.getQuoteVersion(transaction, actor.tenantId, quoteVersionId);
        const token = this.tokens.create({
          linkId: existing.id,
          quoteVersionId,
          tenantId: actor.tenantId,
        }).token;
        return {
          customerPath: `/customer/quotes/${token}`,
          quote: await this.toStaffDto(transaction, context),
          token,
        };
      }

      const context = await this.getQuoteVersion(transaction, actor.tenantId, quoteVersionId, true);
      if (context.version.status !== "ready_to_send") {
        throw invalidState(
          "QUOTE_NOT_READY_TO_SEND",
          "Only a ready-to-send Quote Version can be sent",
        );
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (input.expiresInDays ?? 10) * 86_400_000);
      const linkId = randomUUID();
      const token = this.tokens.create({
        linkId,
        quoteVersionId,
        tenantId: actor.tenantId,
      });
      await transaction.insert(quotePublicLinks).values({
        createdBy: actor.userId,
        creationKeyHash,
        expiresAt,
        id: linkId,
        quoteVersionId,
        requestHash,
        tenantId: actor.tenantId,
        tokenHash: token.hash,
        updatedBy: actor.userId,
      });
      await transaction.insert(quoteDeliveries).values({
        channel: input.channel,
        createdBy: actor.userId,
        quoteVersionId,
        recipient: input.recipient.trim(),
        sentAt: now,
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
      });
      await transaction
        .update(quoteVersions)
        .set({ expiresAt, issuedAt: now, sentAt: now, status: "sent", updatedBy: actor.userId })
        .where(
          and(eq(quoteVersions.tenantId, actor.tenantId), eq(quoteVersions.id, quoteVersionId)),
        );
      await this.updateQuoteStatus(transaction, actor, context.quote.id, "sent");
      await this.intake.markLeadQuoted(transaction, {
        actorUserId: actor.userId,
        leadId: context.quote.leadId,
        quoteVersionId,
        tenantId: actor.tenantId,
      });
      await this.recordChange(transaction, actor, {
        after: { channel: input.channel, expiresAt: expiresAt.toISOString(), status: "sent" },
        before: { status: context.version.status },
        commandName: "SendQuoteVersion",
        entityId: quoteVersionId,
        entityType: "QuoteVersion",
        eventType: "quote.sent",
        metadata: { deliveryRecipient: input.recipient.trim(), quoteId: context.quote.id },
      });
      const updated = await this.getQuoteVersion(transaction, actor.tenantId, quoteVersionId);
      return {
        customerPath: `/customer/quotes/${token.token}`,
        quote: await this.toStaffDto(transaction, updated),
        token: token.token,
      };
    });
  }

  public async withdraw(quoteVersionId: string, idempotencyKey: string): Promise<QuoteVersionDto> {
    return this.terminalTransition(
      quoteVersionId,
      idempotencyKey,
      ["sent", "viewed"],
      "withdrawn",
      "WithdrawQuoteVersion",
      "quote.withdrawn",
    );
  }

  public async expire(quoteVersionId: string, idempotencyKey: string): Promise<QuoteVersionDto> {
    return this.terminalTransition(
      quoteVersionId,
      idempotencyKey,
      ["sent", "viewed"],
      "expired",
      "ExpireQuoteVersion",
      "quote.expired",
      true,
    );
  }

  public async revise(quoteId: string, idempotencyKey: string): Promise<QuoteVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { quoteId },
        scope: "quotes.revise",
      },
      async (transaction) => {
        const current = await this.getLatestQuoteVersion(
          transaction,
          actor.tenantId,
          quoteId,
          true,
        );
        if (current.version.status === "accepted") {
          throw invalidState("QUOTE_ALREADY_ACCEPTED", "An accepted Quote cannot be revised");
        }
        if (current.version.status === "draft") {
          throw invalidState(
            "QUOTE_REVISION_NOT_REQUIRED",
            "The current Quote Version is already a draft",
          );
        }
        await this.supersedeVersion(transaction, actor, current);
        const [version] = await transaction
          .insert(quoteVersions)
          .values({
            adjustmentCents: current.version.adjustmentCents,
            contentHash: current.version.contentHash,
            createdBy: actor.userId,
            customerSnapshot: current.version.customerSnapshot,
            estimateVersionId: current.version.estimateVersionId,
            locationSnapshot: current.version.locationSnapshot,
            quoteId,
            requiredDepositCents: current.version.requiredDepositCents,
            scope: current.version.scope,
            subtotalCents: current.version.subtotalCents,
            taxCents: current.version.taxCents,
            tenantId: actor.tenantId,
            totalCents: current.version.totalCents,
            updatedBy: actor.userId,
            versionNumber: current.version.versionNumber + 1,
          })
          .returning();
        if (!version) throw new Error("Quote revision was not created");
        await transaction.insert(quoteLineItems).values(
          current.lineItems.map((line) => ({
            createdBy: actor.userId,
            description: line.description,
            quantity: line.quantity,
            quoteVersionId: version.id,
            sequence: line.sequence,
            tenantId: actor.tenantId,
            totalCents: line.totalCents,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            updatedBy: actor.userId,
          })),
        );
        await transaction.insert(quoteTerms).values(
          current.terms.map((term) => ({
            body: term.body,
            createdBy: actor.userId,
            quoteVersionId: version.id,
            sequence: term.sequence,
            tenantId: actor.tenantId,
            title: term.title,
            updatedBy: actor.userId,
          })),
        );
        await this.updateQuoteStatus(transaction, actor, quoteId, "draft");
        await this.recordChange(transaction, actor, {
          after: { status: "draft", versionNumber: version.versionNumber },
          before: { status: current.version.status, versionNumber: current.version.versionNumber },
          commandName: "ReviseQuote",
          entityId: version.id,
          entityType: "QuoteVersion",
          eventType: "quote.revised",
          metadata: { quoteId, supersededVersionId: current.version.id },
        });
        return {
          body: await this.toStaffDto(
            transaction,
            await this.getQuoteVersion(transaction, actor.tenantId, version.id),
          ),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async resolvePublic(token: string): Promise<PublicQuoteDto> {
    const parsed = this.parseToken(token);
    return withTenantTransaction(this.database, parsed.tenantId, async (transaction) => {
      const { context, link } = await this.resolveLink(transaction, parsed, false);
      this.assertPubliclyViewable(context.version, link);
      if (context.version.status === "sent") {
        const now = new Date();
        await transaction
          .update(quoteVersions)
          .set({ status: "viewed", viewedAt: now })
          .where(
            and(
              eq(quoteVersions.tenantId, parsed.tenantId),
              eq(quoteVersions.id, context.version.id),
            ),
          );
        await transaction
          .update(quotes)
          .set({ status: "viewed" })
          .where(and(eq(quotes.tenantId, parsed.tenantId), eq(quotes.id, context.quote.id)));
        await this.recordChange(transaction, undefined, {
          after: { status: "viewed" },
          before: { status: "sent" },
          commandName: "ViewQuote",
          entityId: context.version.id,
          entityType: "QuoteVersion",
          eventType: "quote.viewed",
          metadata: { quoteId: context.quote.id },
          tenantId: parsed.tenantId,
        });
        context.version.status = "viewed";
        context.version.viewedAt = now;
      }
      await transaction
        .update(quotePublicLinks)
        .set({ lastViewedAt: new Date(), viewCount: link.viewCount + 1 })
        .where(
          and(eq(quotePublicLinks.tenantId, parsed.tenantId), eq(quotePublicLinks.id, link.id)),
        );
      return toPublicDto(context);
    });
  }

  public async acceptPublic(
    token: string,
    input: AcceptQuoteDto,
    evidence: { ipAddress?: string; userAgent?: string },
  ): Promise<AcceptQuoteResponseDto> {
    const parsed = this.parseToken(token);
    const acceptedName = input.acceptedName.trim();
    const consentText = input.consentText.trim();
    const requestHash = hashCanonicalPayload({
      acceptedName,
      consentText,
      contentHash: input.contentHash,
    });
    return withTenantTransaction(this.database, parsed.tenantId, async (transaction) => {
      const { context, link } = await this.resolveLink(transaction, parsed, true);
      const [existing] = await transaction
        .select()
        .from(quoteAcceptances)
        .where(
          and(
            eq(quoteAcceptances.tenantId, parsed.tenantId),
            eq(quoteAcceptances.quoteVersionId, context.version.id),
          ),
        );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw conflict(
            "QUOTE_ACCEPTANCE_CONFLICT",
            "This Quote was already accepted with different evidence",
          );
        }
        const project = await this.projects.findAcceptedProject(
          transaction,
          parsed.tenantId,
          context.version.id,
        );
        return {
          acceptanceId: existing.id,
          acceptedAt: existing.acceptedAt.toISOString(),
          project,
        };
      }
      this.assertAcceptable(context.version, link);
      if (input.contentHash !== context.version.contentHash) {
        throw conflict(
          "QUOTE_CONTENT_CHANGED",
          "The Quote content changed before acceptance; reload the offer",
        );
      }
      const acceptanceId = randomUUID();
      const acceptedAt = new Date();
      await transaction.insert(quoteAcceptances).values({
        acceptedAt,
        acceptedName,
        acceptanceMethod: "typed_name",
        acceptingContactId: context.quote.primaryContactId,
        consentText,
        contentHash: context.version.contentHash,
        id: acceptanceId,
        ipAddress: evidence.ipAddress,
        quoteVersionId: context.version.id,
        requestHash,
        tenantId: parsed.tenantId,
        userAgent: evidence.userAgent,
      });
      const project = await this.projects.createAcceptedProject(transaction, {
        acceptedQuoteContentHash: context.version.contentHash,
        acceptedQuoteVersionId: context.version.id,
        acceptedValueCents: context.version.totalCents,
        customerAccountId: context.quote.customerAccountId,
        outcomeStatement: context.version.scope,
        ownerUserId: context.quote.ownerUserId,
        primaryContactId: context.quote.primaryContactId,
        requiredDepositCents: context.version.requiredDepositCents,
        serviceLocationId: context.quote.serviceLocationId,
        serviceType: snapshotString(context.version.customerSnapshot, "serviceType"),
        tenantId: parsed.tenantId,
      });
      await transaction
        .update(quoteVersions)
        .set({ status: "accepted", terminalAt: acceptedAt })
        .where(
          and(
            eq(quoteVersions.tenantId, parsed.tenantId),
            eq(quoteVersions.id, context.version.id),
          ),
        );
      await transaction
        .update(quotes)
        .set({ status: "accepted" })
        .where(and(eq(quotes.tenantId, parsed.tenantId), eq(quotes.id, context.quote.id)));
      await this.intake.markLeadAccepted(transaction, {
        acceptanceId,
        leadId: context.quote.leadId,
        quoteVersionId: context.version.id,
        tenantId: parsed.tenantId,
      });
      await this.recordChange(transaction, undefined, {
        after: { acceptedAt: acceptedAt.toISOString(), acceptedName },
        commandName: "AcceptQuoteVersion",
        entityId: context.version.id,
        entityType: "QuoteVersion",
        eventType: "quote.accepted",
        metadata: { acceptanceId, projectId: project.id, quoteId: context.quote.id },
        tenantId: parsed.tenantId,
      });
      return {
        acceptanceId,
        acceptedAt: acceptedAt.toISOString(),
        project,
      };
    });
  }

  public async declinePublic(token: string, input: DeclineQuoteDto): Promise<PublicQuoteDto> {
    const parsed = this.parseToken(token);
    return withTenantTransaction(this.database, parsed.tenantId, async (transaction) => {
      const { context, link } = await this.resolveLink(transaction, parsed, true);
      if (context.version.status === "declined") return toPublicDto(context);
      this.assertAcceptable(context.version, link);
      const terminalAt = new Date();
      await transaction
        .update(quoteVersions)
        .set({ status: "declined", terminalAt })
        .where(
          and(
            eq(quoteVersions.tenantId, parsed.tenantId),
            eq(quoteVersions.id, context.version.id),
          ),
        );
      await transaction
        .update(quotes)
        .set({ status: "declined" })
        .where(and(eq(quotes.tenantId, parsed.tenantId), eq(quotes.id, context.quote.id)));
      await transaction
        .update(quotePublicLinks)
        .set({ revokedAt: terminalAt })
        .where(
          and(eq(quotePublicLinks.tenantId, parsed.tenantId), eq(quotePublicLinks.id, link.id)),
        );
      await this.recordChange(transaction, undefined, {
        after: { reason: input.reason.trim(), status: "declined" },
        before: { status: context.version.status },
        commandName: "DeclineQuoteVersion",
        entityId: context.version.id,
        entityType: "QuoteVersion",
        eventType: "quote.declined",
        metadata: { quoteId: context.quote.id },
        tenantId: parsed.tenantId,
      });
      context.version.status = "declined";
      return toPublicDto(context);
    });
  }

  private async createQuoteVersion(
    transaction: TenantTransaction,
    actor: Actor,
    quote: QuoteRecord,
    estimate: EstimateVersionContext,
    versionNumber: number,
  ): Promise<QuoteVersionContext> {
    const customerSnapshot = {
      contactDisplayName: estimate.lead.primaryContact.displayName,
      contactEmail: estimate.lead.primaryContact.email,
      contactPhone: estimate.lead.primaryContact.phone,
      customerType: estimate.lead.customer.customerType,
      displayName: estimate.lead.customer.displayName,
      serviceType: estimate.lead.serviceType,
    };
    const locationSnapshot = {
      addressLine1: estimate.lead.serviceLocation.addressLine1,
      addressLine2: estimate.lead.serviceLocation.addressLine2,
      city: estimate.lead.serviceLocation.city,
      label: estimate.lead.serviceLocation.label,
      postalCode: estimate.lead.serviceLocation.postalCode,
      region: estimate.lead.serviceLocation.region,
    };
    const lineInputs = estimate.dto.calculations
      .filter(
        (result) =>
          !["deposit", "security_deposit", "weight_overage"].includes(result.code) &&
          result.amountCents > 0,
      )
      .map((result, index) => ({
        description: result.label,
        quantity: "1.000",
        sequence: index,
        totalCents: result.amountCents,
        unit: "service",
        unitPriceCents: result.amountCents,
      }));
    if (lineInputs.length === 0) {
      throw invalidState(
        "QUOTE_LINE_ITEMS_EMPTY",
        "A Quote requires at least one priced line item",
      );
    }
    const terms = [
      {
        body: "This offer covers only the service scope and quantities shown. Changes require a revised written offer.",
        sequence: 0,
        title: "Scope and changes",
      },
      {
        body: "Scheduling is confirmed after acceptance and completion of any required deposit or contract steps.",
        sequence: 1,
        title: "Scheduling",
      },
      {
        body: `A deposit of ${formatMoney(estimate.version.depositCents)} is required under the accepted payment terms.`,
        sequence: 2,
        title: "Deposit",
      },
    ];
    const scope = estimate.lead.summary;
    const subtotalCents =
      estimate.version.approvedQuotePriceCents ?? estimate.version.recommendedPriceCents;
    const contentHash = hashCanonicalPayload({
      adjustmentCents: 0,
      customerSnapshot,
      lineItems: lineInputs,
      locationSnapshot,
      requiredDepositCents: estimate.version.depositCents,
      scope,
      subtotalCents,
      taxCents: 0,
      terms,
      totalCents: subtotalCents,
    });
    const [version] = await transaction
      .insert(quoteVersions)
      .values({
        adjustmentCents: 0,
        contentHash,
        createdBy: actor.userId,
        customerSnapshot,
        estimateVersionId: estimate.version.id,
        locationSnapshot,
        quoteId: quote.id,
        requiredDepositCents: estimate.version.depositCents,
        scope,
        subtotalCents,
        taxCents: 0,
        tenantId: actor.tenantId,
        totalCents: subtotalCents,
        updatedBy: actor.userId,
        versionNumber,
      })
      .returning();
    if (!version) throw new Error("Quote Version was not created");
    const lineItems = await transaction
      .insert(quoteLineItems)
      .values(
        lineInputs.map((line) => ({
          ...line,
          createdBy: actor.userId,
          quoteVersionId: version.id,
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        })),
      )
      .returning();
    const createdTerms = await transaction
      .insert(quoteTerms)
      .values(
        terms.map((term) => ({
          ...term,
          createdBy: actor.userId,
          quoteVersionId: version.id,
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        })),
      )
      .returning();
    return { lineItems, quote, terms: createdTerms, version };
  }

  private async getLatestQuoteVersion(
    transaction: TenantTransaction,
    tenantId: string,
    quoteId: string,
    lock = false,
  ): Promise<QuoteVersionContext> {
    const [quote] = await transaction
      .select()
      .from(quotes)
      .where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, quoteId)));
    if (!quote) throw notFound("QUOTE_NOT_FOUND", "Quote not found");
    const query = transaction
      .select()
      .from(quoteVersions)
      .where(and(eq(quoteVersions.tenantId, tenantId), eq(quoteVersions.quoteId, quoteId)))
      .orderBy(desc(quoteVersions.versionNumber))
      .limit(1);
    const versions = lock ? await query.for("update") : await query;
    const version = versions[0];
    if (!version) throw notFound("QUOTE_VERSION_NOT_FOUND", "Quote Version not found");
    return this.loadQuoteChildren(transaction, quote, version);
  }

  private async getQuoteVersion(
    transaction: TenantTransaction,
    tenantId: string,
    quoteVersionId: string,
    lock = false,
  ): Promise<QuoteVersionContext> {
    const query = transaction
      .select({ quote: quotes, version: quoteVersions })
      .from(quoteVersions)
      .innerJoin(
        quotes,
        and(eq(quotes.tenantId, quoteVersions.tenantId), eq(quotes.id, quoteVersions.quoteId)),
      )
      .where(and(eq(quoteVersions.tenantId, tenantId), eq(quoteVersions.id, quoteVersionId)));
    const records = lock ? await query.for("update") : await query;
    const record = records[0];
    if (!record) throw notFound("QUOTE_VERSION_NOT_FOUND", "Quote Version not found");
    return this.loadQuoteChildren(transaction, record.quote, record.version);
  }

  private async findVersionByEstimate(
    transaction: TenantTransaction,
    tenantId: string,
    estimateVersionId: string,
  ): Promise<QuoteVersionContext | undefined> {
    const [record] = await transaction
      .select({ quote: quotes, version: quoteVersions })
      .from(quoteVersions)
      .innerJoin(
        quotes,
        and(eq(quotes.tenantId, quoteVersions.tenantId), eq(quotes.id, quoteVersions.quoteId)),
      )
      .where(
        and(
          eq(quoteVersions.tenantId, tenantId),
          eq(quoteVersions.estimateVersionId, estimateVersionId),
        ),
      )
      .orderBy(desc(quoteVersions.versionNumber))
      .limit(1);
    return record ? this.loadQuoteChildren(transaction, record.quote, record.version) : undefined;
  }

  private async loadQuoteChildren(
    transaction: TenantTransaction,
    quote: QuoteRecord,
    version: QuoteVersionRecord,
  ): Promise<QuoteVersionContext> {
    const lineItems = await transaction
      .select()
      .from(quoteLineItems)
      .where(
        and(
          eq(quoteLineItems.tenantId, quote.tenantId),
          eq(quoteLineItems.quoteVersionId, version.id),
        ),
      )
      .orderBy(asc(quoteLineItems.sequence));
    const terms = await transaction
      .select()
      .from(quoteTerms)
      .where(
        and(eq(quoteTerms.tenantId, quote.tenantId), eq(quoteTerms.quoteVersionId, version.id)),
      )
      .orderBy(asc(quoteTerms.sequence));
    return { lineItems, quote, terms, version };
  }

  private async toStaffDto(
    transaction: TenantTransaction,
    context: QuoteVersionContext,
  ): Promise<QuoteVersionDto> {
    const deliveries = await transaction
      .select()
      .from(quoteDeliveries)
      .where(
        and(
          eq(quoteDeliveries.tenantId, context.quote.tenantId),
          eq(quoteDeliveries.quoteVersionId, context.version.id),
        ),
      )
      .orderBy(desc(quoteDeliveries.sentAt));
    return {
      adjustmentCents: context.version.adjustmentCents,
      contentHash: context.version.contentHash,
      customerEmail: snapshotOptionalString(context.version.customerSnapshot, "contactEmail") ?? "",
      customerName: snapshotString(context.version.customerSnapshot, "displayName"),
      deliveries: deliveries.map((delivery) => ({
        channel: delivery.channel,
        id: delivery.id,
        recipient: delivery.recipient,
        sentAt: delivery.sentAt.toISOString(),
      })),
      expiresAt: context.version.expiresAt?.toISOString() ?? null,
      id: context.version.id,
      issuedAt: context.version.issuedAt?.toISOString() ?? null,
      lineItems: context.lineItems.map(toLineItemDto),
      locationLabel: snapshotString(context.version.locationSnapshot, "label"),
      quoteId: context.quote.id,
      quoteNumber: context.quote.quoteNumber,
      requiredDepositCents: context.version.requiredDepositCents,
      scope: context.version.scope,
      serviceType: snapshotString(context.version.customerSnapshot, "serviceType"),
      status: context.version.status,
      subtotalCents: context.version.subtotalCents,
      taxCents: context.version.taxCents,
      terms: context.terms.map(toTermDto),
      totalCents: context.version.totalCents,
      versionNumber: context.version.versionNumber,
      viewedAt: context.version.viewedAt?.toISOString() ?? null,
    };
  }

  private async terminalTransition(
    quoteVersionId: string,
    idempotencyKey: string,
    from: string[],
    to: string,
    commandName: string,
    eventType: string,
    requireElapsed = false,
  ): Promise<QuoteVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { quoteVersionId, to },
        scope: `quotes.${to}`,
      },
      async (transaction) => {
        const context = await this.getQuoteVersion(
          transaction,
          actor.tenantId,
          quoteVersionId,
          true,
        );
        if (context.version.status === to) {
          return { body: await this.toStaffDto(transaction, context), status: HttpStatus.OK };
        }
        if (!from.includes(context.version.status)) {
          throw invalidState(
            "QUOTE_TRANSITION_INVALID",
            `A Quote Version in ${context.version.status} cannot transition to ${to}`,
          );
        }
        if (
          requireElapsed &&
          (!context.version.expiresAt || context.version.expiresAt.getTime() > Date.now())
        ) {
          throw invalidState(
            "QUOTE_NOT_EXPIRED",
            "A Quote cannot expire before its expiration time",
          );
        }
        const terminalAt = new Date();
        await transaction
          .update(quoteVersions)
          .set({ status: to, terminalAt, updatedBy: actor.userId })
          .where(
            and(eq(quoteVersions.tenantId, actor.tenantId), eq(quoteVersions.id, quoteVersionId)),
          );
        await this.updateQuoteStatus(transaction, actor, context.quote.id, to);
        await transaction
          .update(quotePublicLinks)
          .set({ revokedAt: terminalAt, updatedBy: actor.userId })
          .where(
            and(
              eq(quotePublicLinks.tenantId, actor.tenantId),
              eq(quotePublicLinks.quoteVersionId, quoteVersionId),
            ),
          );
        await this.recordChange(transaction, actor, {
          after: { status: to },
          before: { status: context.version.status },
          commandName,
          entityId: quoteVersionId,
          entityType: "QuoteVersion",
          eventType,
          metadata: { quoteId: context.quote.id },
        });
        return {
          body: await this.toStaffDto(
            transaction,
            await this.getQuoteVersion(transaction, actor.tenantId, quoteVersionId),
          ),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  private async supersedeVersion(
    transaction: TenantTransaction,
    actor: Actor,
    context: QuoteVersionContext,
  ): Promise<void> {
    await transaction
      .update(quoteVersions)
      .set({ status: "superseded", terminalAt: new Date(), updatedBy: actor.userId })
      .where(
        and(eq(quoteVersions.tenantId, actor.tenantId), eq(quoteVersions.id, context.version.id)),
      );
    await transaction
      .update(quotePublicLinks)
      .set({ revokedAt: new Date(), updatedBy: actor.userId })
      .where(
        and(
          eq(quotePublicLinks.tenantId, actor.tenantId),
          eq(quotePublicLinks.quoteVersionId, context.version.id),
        ),
      );
  }

  private async updateQuoteStatus(
    transaction: TenantTransaction,
    actor: Actor,
    quoteId: string,
    status: string,
  ): Promise<void> {
    await transaction
      .update(quotes)
      .set({ status, updatedBy: actor.userId })
      .where(and(eq(quotes.tenantId, actor.tenantId), eq(quotes.id, quoteId)));
  }

  private parseToken(token: string): ParsedQuoteToken {
    const parsed = this.tokens.parse(token);
    if (!parsed)
      throw publicError(HttpStatus.NOT_FOUND, "QUOTE_LINK_INVALID", "Quote link is invalid");
    return parsed;
  }

  private async resolveLink(
    transaction: TenantTransaction,
    parsed: ParsedQuoteToken,
    lock: boolean,
  ): Promise<{ context: QuoteVersionContext; link: typeof quotePublicLinks.$inferSelect }> {
    const query = transaction
      .select()
      .from(quotePublicLinks)
      .where(
        and(eq(quotePublicLinks.tenantId, parsed.tenantId), eq(quotePublicLinks.id, parsed.linkId)),
      );
    const links = lock ? await query.for("update") : await query;
    const link = links[0];
    if (!link || !this.tokens.matches(parsed.secret, link.tokenHash)) {
      throw publicError(HttpStatus.NOT_FOUND, "QUOTE_LINK_INVALID", "Quote link is invalid");
    }
    const context = await this.getQuoteVersion(
      transaction,
      parsed.tenantId,
      link.quoteVersionId,
      lock,
    );
    return { context, link };
  }

  private assertPubliclyViewable(
    version: QuoteVersionRecord,
    link: typeof quotePublicLinks.$inferSelect,
  ): void {
    if (version.status === "superseded") {
      throw publicError(HttpStatus.GONE, "QUOTE_SUPERSEDED", "This Quote was superseded");
    }
    if (version.status === "withdrawn") {
      throw publicError(HttpStatus.GONE, "QUOTE_WITHDRAWN", "This Quote was withdrawn");
    }
    if (version.status === "expired" || link.expiresAt <= new Date()) {
      throw publicError(HttpStatus.GONE, "QUOTE_EXPIRED", "This Quote has expired");
    }
    if (link.revokedAt && !["accepted", "declined"].includes(version.status)) {
      throw publicError(HttpStatus.GONE, "QUOTE_LINK_REVOKED", "This Quote link was revoked");
    }
    if (!["sent", "viewed", "accepted", "declined"].includes(version.status)) {
      throw publicError(HttpStatus.CONFLICT, "QUOTE_UNAVAILABLE", "This Quote is unavailable");
    }
  }

  private assertAcceptable(
    version: QuoteVersionRecord,
    link: typeof quotePublicLinks.$inferSelect,
  ): void {
    if (!["sent", "viewed"].includes(version.status)) {
      const code =
        version.status === "superseded"
          ? "QUOTE_SUPERSEDED"
          : version.status === "withdrawn"
            ? "QUOTE_WITHDRAWN"
            : version.status === "expired"
              ? "QUOTE_EXPIRED"
              : "QUOTE_NOT_ACCEPTABLE";
      throw publicError(HttpStatus.CONFLICT, code, "This Quote cannot be accepted");
    }
    if (link.revokedAt) {
      throw publicError(HttpStatus.GONE, "QUOTE_LINK_REVOKED", "This Quote link was revoked");
    }
    if (link.expiresAt <= new Date() || !version.expiresAt || version.expiresAt <= new Date()) {
      throw publicError(HttpStatus.GONE, "QUOTE_EXPIRED", "This Quote has expired");
    }
  }

  private assertRecipient(input: SendQuoteDto): void {
    const recipient = input.recipient.trim();
    if (input.channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw invalidInput("QUOTE_RECIPIENT_INVALID", "A valid email recipient is required");
    }
    if (input.channel === "text" && recipient.replace(/\D/g, "").length < 10) {
      throw invalidInput(
        "QUOTE_RECIPIENT_INVALID",
        "A valid text-message phone number is required",
      );
    }
  }

  private async recordChange(
    transaction: TenantTransaction,
    actor: Actor | undefined,
    input: {
      after: unknown;
      before?: unknown;
      commandName: string;
      entityId: string;
      entityType: string;
      eventType: string;
      metadata?: Record<string, unknown>;
      tenantId?: string;
    },
  ): Promise<void> {
    const tenantId = actor?.tenantId ?? input.tenantId;
    if (!tenantId) throw new Error("Tenant is required for commercial events");
    const eventId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: actor?.userId,
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      correlationId: this.context.correlationId(),
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: eventId,
      metadata: input.metadata ?? {},
      tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.entityId,
      aggregateType: input.entityType,
      createdBy: actor?.userId,
      eventType: input.eventType,
      payload: { auditEventId: eventId, ...(input.metadata ?? {}) },
      tenantId,
      updatedBy: actor?.userId,
    });
  }
}

function toPublicDto(context: QuoteVersionContext): PublicQuoteDto {
  const location = context.version.locationSnapshot;
  const addressLine2 = snapshotOptionalString(location, "addressLine2");
  return {
    adjustmentCents: context.version.adjustmentCents,
    contentHash: context.version.contentHash,
    customerName: snapshotString(context.version.customerSnapshot, "displayName"),
    expiresAt: requireDate(context.version.expiresAt, "Quote expiration").toISOString(),
    lineItems: context.lineItems.map(toLineItemDto),
    locationSummary: [
      snapshotString(location, "addressLine1"),
      addressLine2,
      `${snapshotString(location, "city")}, ${snapshotString(location, "region")} ${snapshotString(location, "postalCode")}`,
    ]
      .filter(Boolean)
      .join(", "),
    quoteNumber: context.quote.quoteNumber,
    requiredDepositCents: context.version.requiredDepositCents,
    scope: context.version.scope,
    serviceType: snapshotString(context.version.customerSnapshot, "serviceType"),
    status: context.version.status,
    subtotalCents: context.version.subtotalCents,
    taxCents: context.version.taxCents,
    terms: context.terms.map(toTermDto),
    totalCents: context.version.totalCents,
    versionNumber: context.version.versionNumber,
  };
}

function toLineItemDto(line: typeof quoteLineItems.$inferSelect) {
  return {
    description: line.description,
    id: line.id,
    quantity: line.quantity,
    totalCents: line.totalCents,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
  };
}

function toTermDto(term: typeof quoteTerms.$inferSelect) {
  return { body: term.body, id: term.id, title: term.title };
}

function snapshotString(snapshot: Record<string, unknown>, key: string): string {
  const value = snapshot[key];
  if (typeof value !== "string" || !value) throw new Error(`Quote snapshot ${key} is missing`);
  return value;
}

function snapshotOptionalString(
  snapshot: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = snapshot[key];
  return typeof value === "string" && value ? value : undefined;
}

function requireDate(value: Date | null, label: string): Date {
  if (!value) throw new Error(`${label} is missing`);
  return value;
}

function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${(absolute % 100).toString().padStart(2, "0")}`;
}

function invalidInput(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

function invalidState(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function publicError(status: number, code: string, message: string): ApiException {
  return new ApiException(status, code, message);
}
