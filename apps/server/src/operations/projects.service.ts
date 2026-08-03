import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  allocateBusinessNumber,
  auditEvents,
  contacts,
  contractPublicLinks,
  contractSignatures,
  contracts,
  customerAccounts,
  jobEvents,
  jobs,
  operationalHolds,
  outboxEvents,
  projects,
  serviceLocations,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import {
  hashCanonicalPayload,
  IdempotentCommandService,
} from "../idempotency/idempotent-command.service.js";
import { ContractTokenService, type ParsedContractToken } from "./contract-token.service.js";
import type {
  ConfirmDepositReadinessDto,
  ContractDto,
  LifecycleActionDto,
  ProjectDetailDto,
  ProjectListResponseDto,
  PublicContractDto,
  SendContractDto,
  SendContractResponseDto,
  SignContractDto,
} from "./operations.dto.js";

interface Actor {
  tenantId: string;
  userId: string;
}

export interface CreateAcceptedProjectInput {
  acceptedQuoteContentHash: string;
  acceptedQuoteVersionId: string;
  acceptedValueCents: number;
  customerAccountId: string;
  outcomeStatement: string;
  ownerUserId: string;
  primaryContactId: string;
  requiredDepositCents: number;
  serviceLocationId: string;
  serviceType: string;
  tenantId: string;
}

export interface AcceptedProjectResult {
  id: string;
  outcomeStatement: string;
  projectNumber: string;
  serviceType: string;
  status: string;
}

export const projectTransitionActions = [
  "start-planning",
  "activate",
  "complete-operationally",
  "complete-financially",
  "complete",
  "close",
  "place-hold",
  "release-hold",
  "reopen",
] as const;
export type ProjectTransitionAction = (typeof projectTransitionActions)[number];

@Injectable()
export class ProjectsService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(ContractTokenService) private readonly tokens: ContractTokenService,
  ) {}

  public async list(): Promise<ProjectListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const records = await transaction
        .select({ customerName: customerAccounts.displayName, project: projects })
        .from(projects)
        .innerJoin(
          customerAccounts,
          and(
            eq(customerAccounts.tenantId, projects.tenantId),
            eq(customerAccounts.id, projects.customerAccountId),
          ),
        )
        .where(eq(projects.tenantId, actor.tenantId))
        .orderBy(desc(projects.updatedAt))
        .limit(100);
      return {
        items: records.map(({ customerName, project }) => projectSummary(project, customerName)),
      };
    });
  }

  public async get(projectId: string): Promise<ProjectDetailDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, (transaction) =>
      this.getDetail(transaction, actor.tenantId, projectId),
    );
  }

  public async createAcceptedProject(
    transaction: TenantTransaction,
    input: CreateAcceptedProjectInput,
  ): Promise<AcceptedProjectResult> {
    const [existing] = await transaction
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.tenantId, input.tenantId),
          eq(projects.acceptedQuoteVersionId, input.acceptedQuoteVersionId),
        ),
      );
    if (existing) return acceptedProject(existing);
    const now = new Date();
    const projectNumber = await allocateBusinessNumber(transaction, {
      entityType: "project",
      prefix: "PRJ",
      tenantId: input.tenantId,
      year: now.getUTCFullYear(),
    });
    const [project] = await transaction
      .insert(projects)
      .values({
        acceptedQuoteContentHash: input.acceptedQuoteContentHash,
        acceptedQuoteVersionId: input.acceptedQuoteVersionId,
        acceptedValueCents: input.acceptedValueCents,
        contractRequirement: "required",
        contractStatus: "pending",
        customerAccountId: input.customerAccountId,
        depositRequirement: input.requiredDepositCents > 0 ? "required" : "waived",
        depositStatus: input.requiredDepositCents > 0 ? "pending" : "waived",
        outcomeStatement: input.outcomeStatement,
        ownerUserId: input.ownerUserId,
        primaryContactId: input.primaryContactId,
        projectNumber,
        requiredDepositCents: input.requiredDepositCents,
        serviceLocationId: input.serviceLocationId,
        serviceType: input.serviceType,
        status: "pending_contract",
        tenantId: input.tenantId,
      })
      .returning();
    if (!project) throw new Error("Project was not created");
    const prefix = input.serviceType === "material_delivery" ? "MAT" : "DTR";
    const jobNumber = await allocateBusinessNumber(transaction, {
      entityType: `job_${prefix.toLowerCase()}`,
      prefix,
      tenantId: input.tenantId,
      year: now.getUTCFullYear(),
    });
    const [job] = await transaction
      .insert(jobs)
      .values({
        jobNumber,
        projectId: project.id,
        serviceType: input.serviceType,
        tenantId: input.tenantId,
      })
      .returning();
    if (!job) throw new Error("Initial Job was not created");
    await transaction.insert(jobEvents).values({
      eventType: "job.created",
      jobId: job.id,
      metadata: { projectId: project.id, quoteVersionId: input.acceptedQuoteVersionId },
      summary: "Initial job created from accepted quote",
      tenantId: input.tenantId,
    });
    await this.recordChange(transaction, undefined, {
      after: { jobId: job.id, projectNumber, status: project.status },
      commandName: "CreateProjectFromQuoteAcceptance",
      entityId: project.id,
      entityType: "Project",
      eventType: "project.created_from_quote",
      metadata: { jobId: job.id, quoteVersionId: input.acceptedQuoteVersionId },
      tenantId: input.tenantId,
    });
    await this.recordChange(transaction, undefined, {
      after: { jobNumber, status: job.status },
      commandName: "CreateInitialJob",
      entityId: job.id,
      entityType: "Job",
      eventType: "job.created",
      metadata: { projectId: project.id },
      tenantId: input.tenantId,
    });
    return acceptedProject(project);
  }

  public async findAcceptedProject(
    transaction: TenantTransaction,
    tenantId: string,
    quoteVersionId: string,
  ): Promise<AcceptedProjectResult> {
    const [project] = await transaction
      .select()
      .from(projects)
      .where(
        and(eq(projects.tenantId, tenantId), eq(projects.acceptedQuoteVersionId, quoteVersionId)),
      );
    if (!project) throw new Error("Accepted Quote Project was not found");
    return acceptedProject(project);
  }

  public async generateContract(projectId: string, key: string): Promise<ProjectDetailDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { projectId }, scope: "projects.generate-contract" },
      async (transaction) => {
        const project = await this.lockProject(transaction, actor.tenantId, projectId);
        const [existing] = await transaction
          .select()
          .from(contracts)
          .where(and(eq(contracts.tenantId, actor.tenantId), eq(contracts.projectId, projectId)));
        if (!existing) {
          const [customer] = await transaction
            .select()
            .from(customerAccounts)
            .where(
              and(
                eq(customerAccounts.tenantId, actor.tenantId),
                eq(customerAccounts.id, project.customerAccountId),
              ),
            );
          const [contact] = await transaction
            .select()
            .from(contacts)
            .where(
              and(eq(contacts.tenantId, actor.tenantId), eq(contacts.id, project.primaryContactId)),
            );
          const [location] = await transaction
            .select()
            .from(serviceLocations)
            .where(
              and(
                eq(serviceLocations.tenantId, actor.tenantId),
                eq(serviceLocations.id, project.serviceLocationId),
              ),
            );
          if (!customer || !contact || !location)
            throw new Error("Project commercial context is incomplete");
          const content = {
            acceptedValueCents: project.acceptedValueCents,
            customerName: customer.displayName,
            customerType: customer.customerType,
            primaryContactName: contact.displayName,
            projectNumber: project.projectNumber,
            requiredDepositCents: project.requiredDepositCents,
            scope: project.outcomeStatement,
            serviceLocation: formatLocation(location),
            serviceType: project.serviceType,
            terms: [
              "Work is limited to the accepted scope and approved changes.",
              "Scheduling is subject to contract execution, deposit readiness, weather, access, and asset availability.",
              "Final charges may reflect approved changes and documented operational quantities.",
            ],
          };
          const contractNumber = await allocateBusinessNumber(transaction, {
            entityType: "contract",
            prefix: "CTR",
            tenantId: actor.tenantId,
            year: new Date().getUTCFullYear(),
          });
          const [contract] = await transaction
            .insert(contracts)
            .values({
              contentHash: hashCanonicalPayload(content),
              contentSnapshot: content,
              contractNumber,
              createdBy: actor.userId,
              projectId,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!contract) throw new Error("Contract was not created");
          await transaction
            .update(projects)
            .set({ contractStatus: "generated", updatedBy: actor.userId })
            .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, projectId)));
          await this.recordChange(transaction, actor, {
            after: { contractNumber, status: "draft" },
            commandName: "GenerateContract",
            entityId: contract.id,
            entityType: "Contract",
            eventType: "contract.generated",
            metadata: { projectId },
          });
          await this.recordChange(transaction, actor, {
            after: { contractStatus: "generated" },
            before: { contractStatus: project.contractStatus },
            commandName: "RecordProjectContractGenerated",
            entityId: projectId,
            entityType: "Project",
            eventType: "project.contract_generated",
            metadata: { contractId: contract.id },
          });
        }
        return {
          body: await this.getDetail(transaction, actor.tenantId, projectId),
          status: existing ? HttpStatus.OK : HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async signBusiness(
    contractId: string,
    input: SignContractDto,
    key: string,
  ): Promise<ContractDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { contractId, input }, scope: "contracts.sign-business" },
      async (transaction) => {
        const contract = await this.lockContract(transaction, actor.tenantId, contractId);
        if (contract.status === "business_signed") {
          const [signature] = await transaction
            .select()
            .from(contractSignatures)
            .where(
              and(
                eq(contractSignatures.tenantId, actor.tenantId),
                eq(contractSignatures.contractId, contractId),
                eq(contractSignatures.signerRole, "business"),
              ),
            );
          if (signature?.requestHash !== hashCanonicalPayload(input))
            throw conflict(
              "CONTRACT_SIGNATURE_CONFLICT",
              "The business signature was recorded with different evidence",
            );
          return { body: await this.contractDto(transaction, contract), status: HttpStatus.OK };
        }
        if (contract.status !== "draft")
          throw invalidState(
            "CONTRACT_NOT_DRAFT",
            "Only a draft Contract can receive the business signature",
          );
        if (input.contentHash !== contract.contentHash)
          throw conflict("CONTRACT_CONTENT_CHANGED", "Contract content changed before signature");
        await transaction.insert(contractSignatures).values({
          consentText: input.consentText.trim(),
          contentHash: contract.contentHash,
          contractId,
          createdBy: actor.userId,
          requestHash: hashCanonicalPayload(input),
          signerRole: "business",
          signerUserId: actor.userId,
          tenantId: actor.tenantId,
          typedName: input.typedName.trim(),
          updatedBy: actor.userId,
        });
        await transaction
          .update(contracts)
          .set({ status: "business_signed", updatedBy: actor.userId })
          .where(and(eq(contracts.tenantId, actor.tenantId), eq(contracts.id, contractId)));
        await transaction
          .update(projects)
          .set({ contractStatus: "business_signed", updatedBy: actor.userId })
          .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, contract.projectId)));
        await this.recordChange(transaction, actor, {
          after: { signerRole: "business", status: "business_signed" },
          commandName: "SignContractAsBusiness",
          entityId: contractId,
          entityType: "Contract",
          eventType: "contract.business_signed",
          metadata: { projectId: contract.projectId },
        });
        await this.recordChange(transaction, actor, {
          after: { contractStatus: "business_signed" },
          before: { contractStatus: "generated" },
          commandName: "RecordProjectBusinessSignature",
          entityId: contract.projectId,
          entityType: "Project",
          eventType: "project.contract_business_signed",
          metadata: { contractId },
        });
        return {
          body: await this.contractDto(transaction, { ...contract, status: "business_signed" }),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async sendContract(
    contractId: string,
    input: SendContractDto,
    key: string,
  ): Promise<SendContractResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const creationKeyHash = this.tokens.creationKeyHash(key);
      const requestHash = hashCanonicalPayload({ contractId, input });
      const [existing] = await transaction
        .select()
        .from(contractPublicLinks)
        .where(
          and(
            eq(contractPublicLinks.tenantId, actor.tenantId),
            eq(contractPublicLinks.creationKeyHash, creationKeyHash),
          ),
        )
        .for("update");
      if (existing) {
        if (existing.contractId !== contractId || existing.requestHash !== requestHash)
          throw conflict(
            "IDEMPOTENCY_KEY_CONFLICT",
            "Idempotency key was used for another Contract send",
          );
        const contract = await this.lockContract(transaction, actor.tenantId, contractId);
        const token = this.tokens.create({
          contractId,
          linkId: existing.id,
          tenantId: actor.tenantId,
        }).token;
        return {
          contract: await this.contractDto(transaction, contract),
          customerPath: `/customer/contracts/${token}`,
          token,
        };
      }
      const contract = await this.lockContract(transaction, actor.tenantId, contractId);
      if (contract.status !== "business_signed")
        throw invalidState(
          "CONTRACT_NOT_BUSINESS_SIGNED",
          "The business must sign the Contract before sending it",
        );
      const linkId = randomUUID();
      const token = this.tokens.create({ contractId, linkId, tenantId: actor.tenantId });
      const expiresAt = new Date(Date.now() + (input.expiresInDays ?? 10) * 86_400_000);
      await transaction.insert(contractPublicLinks).values({
        contractId,
        createdBy: actor.userId,
        creationKeyHash,
        expiresAt,
        id: linkId,
        recipient: input.recipient.trim().toLowerCase(),
        requestHash,
        tenantId: actor.tenantId,
        tokenHash: token.hash,
        updatedBy: actor.userId,
      });
      const issuedAt = new Date();
      await transaction
        .update(contracts)
        .set({ issuedAt, status: "sent", updatedBy: actor.userId })
        .where(and(eq(contracts.tenantId, actor.tenantId), eq(contracts.id, contractId)));
      await transaction
        .update(projects)
        .set({ contractStatus: "sent", updatedBy: actor.userId })
        .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, contract.projectId)));
      await this.recordChange(transaction, actor, {
        after: { recipient: input.recipient.trim().toLowerCase(), requestHash, status: "sent" },
        commandName: "SendContract",
        entityId: contractId,
        entityType: "Contract",
        eventType: "contract.sent",
        metadata: { projectId: contract.projectId },
      });
      await this.recordChange(transaction, actor, {
        after: { contractStatus: "sent" },
        before: { contractStatus: "business_signed" },
        commandName: "RecordProjectContractSent",
        entityId: contract.projectId,
        entityType: "Project",
        eventType: "project.contract_sent",
        metadata: { contractId },
      });
      return {
        contract: await this.contractDto(transaction, { ...contract, issuedAt, status: "sent" }),
        customerPath: `/customer/contracts/${token.token}`,
        token: token.token,
      };
    });
  }

  public async resolvePublic(token: string): Promise<PublicContractDto> {
    const parsed = this.parseToken(token);
    return withTenantTransaction(this.database, parsed.tenantId, async (transaction) => {
      const { contract, link } = await this.resolveLink(transaction, parsed, false);
      this.assertLinkAvailable(contract, link);
      if (contract.status === "sent") {
        await transaction
          .update(contracts)
          .set({ status: "viewed" })
          .where(and(eq(contracts.tenantId, parsed.tenantId), eq(contracts.id, contract.id)));
        await transaction
          .update(projects)
          .set({ contractStatus: "viewed" })
          .where(and(eq(projects.tenantId, parsed.tenantId), eq(projects.id, contract.projectId)));
        contract.status = "viewed";
        await this.recordChange(transaction, undefined, {
          after: { status: "viewed" },
          before: { status: "sent" },
          commandName: "ViewContract",
          entityId: contract.id,
          entityType: "Contract",
          eventType: "contract.viewed",
          metadata: { projectId: contract.projectId },
          tenantId: parsed.tenantId,
        });
        await this.recordChange(transaction, undefined, {
          after: { contractStatus: "viewed" },
          before: { contractStatus: "sent" },
          commandName: "RecordProjectContractViewed",
          entityId: contract.projectId,
          entityType: "Project",
          eventType: "project.contract_viewed",
          metadata: { contractId: contract.id },
          tenantId: parsed.tenantId,
        });
      }
      await transaction
        .update(contractPublicLinks)
        .set({ lastViewedAt: new Date(), viewCount: link.viewCount + 1 })
        .where(
          and(
            eq(contractPublicLinks.tenantId, parsed.tenantId),
            eq(contractPublicLinks.id, link.id),
          ),
        );
      return this.publicContractDto(transaction, contract);
    });
  }

  public async signPublic(
    token: string,
    input: SignContractDto,
    evidence: { ipAddress?: string; userAgent?: string },
  ): Promise<PublicContractDto> {
    const parsed = this.parseToken(token);
    return withTenantTransaction(this.database, parsed.tenantId, async (transaction) => {
      const { contract, link } = await this.resolveLink(transaction, parsed, true);
      this.assertLinkAvailable(contract, link);
      const requestHash = hashCanonicalPayload(input);
      const [existing] = await transaction
        .select()
        .from(contractSignatures)
        .where(
          and(
            eq(contractSignatures.tenantId, parsed.tenantId),
            eq(contractSignatures.contractId, contract.id),
            eq(contractSignatures.signerRole, "customer"),
          ),
        );
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw conflict(
            "CONTRACT_SIGNATURE_CONFLICT",
            "This Contract was signed with different evidence",
          );
        return this.publicContractDto(transaction, { ...contract, status: "executed" });
      }
      if (!["sent", "viewed"].includes(contract.status))
        throw invalidState("CONTRACT_NOT_SIGNABLE", "This Contract cannot be signed");
      if (input.contentHash !== contract.contentHash)
        throw conflict("CONTRACT_CONTENT_CHANGED", "Contract content changed before signature");
      const [project] = await transaction
        .select()
        .from(projects)
        .where(and(eq(projects.tenantId, parsed.tenantId), eq(projects.id, contract.projectId)))
        .for("update");
      if (!project) throw new Error("Contract Project was not found");
      await transaction.insert(contractSignatures).values({
        consentText: input.consentText.trim(),
        contentHash: contract.contentHash,
        contractId: contract.id,
        ipAddress: evidence.ipAddress,
        requestHash,
        signerContactId: project.primaryContactId,
        signerRole: "customer",
        tenantId: parsed.tenantId,
        typedName: input.typedName.trim(),
        userAgent: evidence.userAgent,
      });
      const executedAt = new Date();
      await transaction
        .update(contracts)
        .set({ executedAt, status: "executed" })
        .where(and(eq(contracts.tenantId, parsed.tenantId), eq(contracts.id, contract.id)));
      const nextStatus =
        project.depositStatus === "satisfied" || project.depositStatus === "waived"
          ? "ready_for_planning"
          : "pending_deposit";
      await transaction
        .update(projects)
        .set({ contractStatus: "executed", status: nextStatus })
        .where(and(eq(projects.tenantId, parsed.tenantId), eq(projects.id, project.id)));
      await transaction
        .update(contractPublicLinks)
        .set({ revokedAt: executedAt })
        .where(
          and(
            eq(contractPublicLinks.tenantId, parsed.tenantId),
            eq(contractPublicLinks.id, link.id),
          ),
        );
      await this.recordChange(transaction, undefined, {
        after: { signerRole: "customer", status: "executed" },
        commandName: "SignContractAsCustomer",
        entityId: contract.id,
        entityType: "Contract",
        eventType: "contract.executed",
        metadata: { projectId: project.id },
        tenantId: parsed.tenantId,
      });
      await this.recordChange(transaction, undefined, {
        after: { contractStatus: "executed", status: nextStatus },
        before: { contractStatus: project.contractStatus, status: project.status },
        commandName: "RecordProjectContractExecution",
        entityId: project.id,
        entityType: "Project",
        eventType: "project.contract_executed",
        metadata: { contractId: contract.id },
        tenantId: parsed.tenantId,
      });
      return this.publicContractDto(transaction, { ...contract, executedAt, status: "executed" });
    });
  }

  public async confirmDeposit(
    projectId: string,
    input: ConfirmDepositReadinessDto,
    key: string,
  ): Promise<ProjectDetailDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, projectId }, scope: "projects.confirm-deposit-readiness" },
      async (transaction) => {
        const project = await this.lockProject(transaction, actor.tenantId, projectId);
        if (project.depositStatus !== "satisfied") {
          if (project.contractStatus !== "executed" && project.contractRequirement !== "waived")
            throw invalidState(
              "PROJECT_CONTRACT_NOT_EXECUTED",
              "Contract execution is required before deposit readiness can be confirmed",
            );
          await transaction
            .update(projects)
            .set({
              depositEvidenceReference: input.evidenceReference.trim(),
              depositStatus: "satisfied",
              status: "ready_for_planning",
              updatedBy: actor.userId,
            })
            .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, projectId)));
          await this.recordChange(transaction, actor, {
            after: { evidenceReference: input.evidenceReference.trim(), status: "satisfied" },
            commandName: "ConfirmDepositReadiness",
            entityId: projectId,
            entityType: "Project",
            eventType: "project.deposit_readiness_confirmed",
          });
        }
        return {
          body: await this.getDetail(transaction, actor.tenantId, projectId),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async transition(
    projectId: string,
    action: ProjectTransitionAction,
    input: LifecycleActionDto,
    key: string,
  ): Promise<ProjectDetailDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { action, input, projectId }, scope: `projects.transition.${action}` },
      async (transaction) => {
        const project = await this.lockProject(transaction, actor.tenantId, projectId);
        if (action === "place-hold") {
          requireReason(input.reason);
          if (["closed", "on_hold"].includes(project.status))
            throw invalidState("PROJECT_HOLD_INVALID", "This Project cannot be placed on hold");
          await transaction.insert(operationalHolds).values({
            createdBy: actor.userId,
            placedBy: actor.userId,
            previousStatus: project.status,
            projectId,
            reason: input.reason.trim(),
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          });
          await transaction
            .update(projects)
            .set({ status: "on_hold", updatedBy: actor.userId })
            .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, projectId)));
          await this.recordChange(transaction, actor, {
            after: { status: "on_hold" },
            before: { status: project.status },
            commandName: "PlaceProjectHold",
            entityId: projectId,
            entityType: "Project",
            eventType: "project.held",
          });
        } else if (action === "release-hold") {
          const hold = await this.activeHold(transaction, actor.tenantId, "project", projectId);
          if (!hold || project.status !== "on_hold")
            throw invalidState("PROJECT_NOT_ON_HOLD", "Project has no active hold");
          const reason = optionalReason(input.reason, "Hold resolved");
          await transaction
            .update(operationalHolds)
            .set({
              releaseReason: reason,
              releasedAt: new Date(),
              releasedBy: actor.userId,
              status: "released",
              updatedBy: actor.userId,
            })
            .where(
              and(eq(operationalHolds.tenantId, actor.tenantId), eq(operationalHolds.id, hold.id)),
            );
          await transaction
            .update(projects)
            .set({ status: hold.previousStatus, updatedBy: actor.userId })
            .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, projectId)));
          await this.recordChange(transaction, actor, {
            after: { status: hold.previousStatus },
            before: { status: "on_hold" },
            commandName: "ReleaseProjectHold",
            entityId: projectId,
            entityType: "Project",
            eventType: "project.hold_released",
          });
        } else {
          const transition = projectTransitions[action];
          if (project.status !== transition.from)
            throw invalidState(
              "PROJECT_TRANSITION_INVALID",
              `Project must be ${transition.from} before ${action}`,
            );
          if (
            action === "start-planning" &&
            (project.contractStatus !== "executed" ||
              !["satisfied", "waived"].includes(project.depositStatus))
          )
            throw invalidState(
              "PROJECT_NOT_READY_FOR_PLANNING",
              "Contract and deposit readiness are required before planning",
            );
          if (action === "reopen") requireReason(input.reason);
          const now = new Date();
          const timestamps: Partial<typeof projects.$inferInsert> = {};
          if (action === "complete-operationally") timestamps.operationallyCompletedAt = now;
          if (action === "complete-financially") timestamps.financiallyCompletedAt = now;
          if (action === "complete") timestamps.completedAt = now;
          if (action === "close") timestamps.closedAt = now;
          if (action === "reopen") timestamps.reopenedAt = now;
          await transaction
            .update(projects)
            .set({ ...timestamps, status: transition.to, updatedBy: actor.userId })
            .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, projectId)));
          await this.recordChange(transaction, actor, {
            after: { reason: input.reason, status: transition.to },
            before: { status: project.status },
            commandName: transition.command,
            entityId: projectId,
            entityType: "Project",
            eventType: transition.event,
          });
        }
        return {
          body: await this.getDetail(transaction, actor.tenantId, projectId),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  private async getDetail(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<ProjectDetailDto> {
    const [record] = await transaction
      .select({ customer: customerAccounts, project: projects })
      .from(projects)
      .innerJoin(
        customerAccounts,
        and(
          eq(customerAccounts.tenantId, projects.tenantId),
          eq(customerAccounts.id, projects.customerAccountId),
        ),
      )
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)));
    if (!record) throw notFound("PROJECT_NOT_FOUND", "Project was not found");
    const [contact] = await transaction
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.tenantId, tenantId), eq(contacts.id, record.project.primaryContactId)),
      );
    const [location] = await transaction
      .select()
      .from(serviceLocations)
      .where(
        and(
          eq(serviceLocations.tenantId, tenantId),
          eq(serviceLocations.id, record.project.serviceLocationId),
        ),
      );
    const jobRecords = await transaction
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.projectId, projectId)))
      .orderBy(jobs.createdAt);
    const [contract] = await transaction
      .select()
      .from(contracts)
      .where(and(eq(contracts.tenantId, tenantId), eq(contracts.projectId, projectId)));
    const holds = await transaction
      .select()
      .from(operationalHolds)
      .where(
        and(
          eq(operationalHolds.tenantId, tenantId),
          eq(operationalHolds.projectId, projectId),
          eq(operationalHolds.status, "active"),
        ),
      );
    return {
      ...projectSummary(record.project, record.customer.displayName),
      activeHolds: holds.map((hold) => hold.reason),
      contactName: contact?.displayName ?? "Unknown contact",
      contract: contract ? await this.contractDto(transaction, contract) : null,
      customerAccountId: record.customer.id,
      jobs: jobRecords.map((job) => ({
        customerName: record.customer.displayName,
        id: job.id,
        jobNumber: job.jobNumber,
        projectId,
        projectNumber: record.project.projectNumber,
        readiness: job.readiness,
        scheduledEndAt: job.scheduledEndAt?.toISOString() ?? null,
        scheduledStartAt: job.scheduledStartAt?.toISOString() ?? null,
        serviceType: job.serviceType,
        status: job.status,
      })),
      outcomeStatement: record.project.outcomeStatement,
      serviceLocation: location ? formatLocation(location) : "Unknown location",
    };
  }

  private async contractDto(
    transaction: TenantTransaction,
    contract: typeof contracts.$inferSelect,
  ): Promise<ContractDto> {
    const signatures = await transaction
      .select()
      .from(contractSignatures)
      .where(
        and(
          eq(contractSignatures.tenantId, contract.tenantId),
          eq(contractSignatures.contractId, contract.id),
        ),
      )
      .orderBy(contractSignatures.signedAt);
    return {
      content: contract.contentSnapshot,
      contentHash: contract.contentHash,
      contractNumber: contract.contractNumber,
      id: contract.id,
      signatures: signatures.map((signature) => ({
        id: signature.id,
        signedAt: signature.signedAt.toISOString(),
        signerRole: signature.signerRole,
        typedName: signature.typedName,
      })),
      status: contract.status,
      versionNumber: contract.versionNumber,
    };
  }

  private async publicContractDto(
    transaction: TenantTransaction,
    contract: typeof contracts.$inferSelect,
  ): Promise<PublicContractDto> {
    const content = contract.contentSnapshot;
    const dto = await this.contractDto(transaction, contract);
    return {
      acceptedValueCents: requiredNumber(content, "acceptedValueCents"),
      contentHash: contract.contentHash,
      contractNumber: contract.contractNumber,
      customerName: requiredString(content, "customerName"),
      requiredDepositCents: requiredNumber(content, "requiredDepositCents"),
      scope: requiredString(content, "scope"),
      serviceLocation: requiredString(content, "serviceLocation"),
      signatures: dto.signatures,
      status: contract.status,
      terms: requiredStringArray(content, "terms"),
    };
  }

  private async lockProject(transaction: TenantTransaction, tenantId: string, id: string) {
    const [project] = await transaction
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)))
      .for("update");
    if (!project) throw notFound("PROJECT_NOT_FOUND", "Project was not found");
    return project;
  }

  private async lockContract(transaction: TenantTransaction, tenantId: string, id: string) {
    const [contract] = await transaction
      .select()
      .from(contracts)
      .where(and(eq(contracts.tenantId, tenantId), eq(contracts.id, id)))
      .for("update");
    if (!contract) throw notFound("CONTRACT_NOT_FOUND", "Contract was not found");
    return contract;
  }

  private parseToken(token: string): ParsedContractToken {
    const parsed = this.tokens.parse(token);
    if (!parsed) throw notFound("CONTRACT_LINK_INVALID", "Contract link is invalid");
    return parsed;
  }

  private async resolveLink(
    transaction: TenantTransaction,
    parsed: ParsedContractToken,
    lock: boolean,
  ) {
    const query = transaction
      .select()
      .from(contractPublicLinks)
      .where(
        and(
          eq(contractPublicLinks.tenantId, parsed.tenantId),
          eq(contractPublicLinks.id, parsed.linkId),
        ),
      );
    const links = lock ? await query.for("update") : await query;
    const link = links[0];
    if (!link || !this.tokens.matches(parsed.secret, link.tokenHash))
      throw notFound("CONTRACT_LINK_INVALID", "Contract link is invalid");
    const contract = await this.lockContract(transaction, parsed.tenantId, link.contractId);
    return { contract, link };
  }

  private assertLinkAvailable(
    contract: typeof contracts.$inferSelect,
    link: typeof contractPublicLinks.$inferSelect,
  ): void {
    if (contract.status === "voided")
      throw new ApiException(HttpStatus.GONE, "CONTRACT_VOIDED", "This Contract was voided");
    if (link.expiresAt <= new Date())
      throw new ApiException(
        HttpStatus.GONE,
        "CONTRACT_LINK_EXPIRED",
        "This Contract link expired",
      );
    if (link.revokedAt && contract.status !== "executed")
      throw new ApiException(
        HttpStatus.GONE,
        "CONTRACT_LINK_REVOKED",
        "This Contract link was revoked",
      );
  }

  private async activeHold(
    transaction: TenantTransaction,
    tenantId: string,
    owner: "project",
    id: string,
  ) {
    void owner;
    const [hold] = await transaction
      .select()
      .from(operationalHolds)
      .where(
        and(
          eq(operationalHolds.tenantId, tenantId),
          eq(operationalHolds.projectId, id),
          eq(operationalHolds.status, "active"),
        ),
      )
      .for("update");
    return hold;
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
    if (!tenantId) throw new Error("Tenant is required for operations events");
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

const projectTransitions: Record<
  Exclude<ProjectTransitionAction, "place-hold" | "release-hold">,
  { command: string; event: string; from: string; to: string }
> = {
  "start-planning": {
    command: "StartProjectPlanning",
    event: "project.planning_started",
    from: "ready_for_planning",
    to: "planning",
  },
  activate: {
    command: "ActivateProject",
    event: "project.activated",
    from: "planning",
    to: "active",
  },
  "complete-operationally": {
    command: "CompleteProjectOperationally",
    event: "project.operationally_completed",
    from: "active",
    to: "operationally_complete",
  },
  "complete-financially": {
    command: "CompleteProjectFinancially",
    event: "project.financially_completed",
    from: "operationally_complete",
    to: "financially_complete",
  },
  complete: {
    command: "CompleteProject",
    event: "project.completed",
    from: "financially_complete",
    to: "completed",
  },
  close: { command: "CloseProject", event: "project.closed", from: "completed", to: "closed" },
  reopen: { command: "ReopenProject", event: "project.reopened", from: "closed", to: "planning" },
};

function acceptedProject(project: typeof projects.$inferSelect): AcceptedProjectResult {
  return {
    id: project.id,
    outcomeStatement: project.outcomeStatement,
    projectNumber: project.projectNumber,
    serviceType: project.serviceType,
    status: project.status,
  };
}

function projectSummary(project: typeof projects.$inferSelect, customerName: string) {
  return {
    acceptedValueCents: project.acceptedValueCents,
    contractStatus: project.contractStatus,
    customerName,
    depositStatus: project.depositStatus,
    id: project.id,
    projectNumber: project.projectNumber,
    requiredDepositCents: project.requiredDepositCents,
    serviceType: project.serviceType,
    status: project.status,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function formatLocation(location: typeof serviceLocations.$inferSelect): string {
  return [
    location.addressLine1,
    location.addressLine2,
    `${location.city}, ${location.region} ${location.postalCode}`,
  ]
    .filter(Boolean)
    .join(", ");
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Contract ${key} is invalid`);
  return field;
}

function requiredNumber(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number") throw new Error(`Contract ${key} is invalid`);
  return field;
}

function requiredStringArray(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((item) => typeof item === "string")) {
    throw new Error(`Contract ${key} is invalid`);
  }
  return field;
}

function optionalReason(value: string | undefined, fallback: string): string {
  const reason = value?.trim();
  return reason?.length ? reason : fallback;
}

function requireReason(value: string | undefined): asserts value is string {
  if (!value?.trim())
    throw new ApiException(HttpStatus.BAD_REQUEST, "REASON_REQUIRED", "A reason is required");
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function invalidState(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}
