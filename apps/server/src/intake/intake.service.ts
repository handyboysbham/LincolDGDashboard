import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  accountContacts,
  allocateBusinessNumber,
  auditEvents,
  contacts,
  customerAccounts,
  leadNotes,
  leads,
  leadTasks,
  locationContacts,
  outboxEvents,
  serviceLocations,
  users,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { DocumentsService } from "../documents/documents.service.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import type {
  ContactDto,
  CreateIntakeLeadDto,
  CreateIntakeLeadResponseDto,
  CreateLeadNoteDto,
  CreateLeadTaskDto,
  CustomerAccountDto,
  CustomerDetailDto,
  CustomerListResponseDto,
  DuplicateCheckDto,
  DuplicateCheckResponseDto,
  DuplicateWarningDto,
  LeadDetailDto,
  LeadDocumentDto,
  LeadDto,
  LeadListResponseDto,
  LeadNoteDto,
  LeadTaskDto,
  LinkLeadDocumentDto,
  NewContactDto,
  ServiceLocationDto,
  TransitionLeadDto,
} from "./intake.dto.js";
import {
  normalizeAddress,
  normalizeCustomerName,
  normalizeEmail,
  normalizePhone,
} from "./intake-normalization.js";

type CustomerRecord = typeof customerAccounts.$inferSelect;
type ContactRecord = typeof contacts.$inferSelect;
type LeadRecord = typeof leads.$inferSelect;
type LocationRecord = typeof serviceLocations.$inferSelect;

const leadStatusValues = new Set([
  "new",
  "contacting",
  "qualified",
  "estimating",
  "quoted",
  "accepted",
  "lost",
  "cancelled",
  "duplicate",
  "disqualified",
]);

export const leadTransitionActions = [
  "start-contacting",
  "qualify",
  "start-estimating",
  "mark-lost",
  "cancel",
  "mark-duplicate",
  "disqualify",
] as const;

export type LeadTransitionAction = (typeof leadTransitionActions)[number];

const transitionDefinitions: Record<
  LeadTransitionAction,
  { commandName: string; eventType: string; from: string[]; reasonRequired: boolean; to: string }
> = {
  "start-contacting": {
    commandName: "StartContactingLead",
    eventType: "lead.contacting_started",
    from: ["new"],
    reasonRequired: false,
    to: "contacting",
  },
  qualify: {
    commandName: "QualifyLead",
    eventType: "lead.qualified",
    from: ["contacting"],
    reasonRequired: false,
    to: "qualified",
  },
  "start-estimating": {
    commandName: "StartEstimatingLead",
    eventType: "lead.estimating_started",
    from: ["qualified"],
    reasonRequired: false,
    to: "estimating",
  },
  "mark-lost": {
    commandName: "MarkLeadLost",
    eventType: "lead.lost",
    from: ["new", "contacting", "qualified", "estimating"],
    reasonRequired: true,
    to: "lost",
  },
  cancel: {
    commandName: "CancelLead",
    eventType: "lead.cancelled",
    from: ["new", "contacting", "qualified", "estimating"],
    reasonRequired: true,
    to: "cancelled",
  },
  "mark-duplicate": {
    commandName: "MarkLeadDuplicate",
    eventType: "lead.duplicate_marked",
    from: ["new", "contacting", "qualified", "estimating"],
    reasonRequired: true,
    to: "duplicate",
  },
  disqualify: {
    commandName: "DisqualifyLead",
    eventType: "lead.disqualified",
    from: ["new", "contacting", "qualified", "estimating"],
    reasonRequired: true,
    to: "disqualified",
  },
};

@Injectable()
export class IntakeService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  public async checkDuplicates(input: DuplicateCheckDto): Promise<DuplicateCheckResponseDto> {
    this.assertDuplicateCheck(input);
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => ({
      warnings: await this.findDuplicateWarnings(transaction, actor.tenantId, input),
    }));
  }

  public async createLead(
    input: CreateIntakeLeadDto,
    idempotencyKey: string,
  ): Promise<CreateIntakeLeadResponseDto> {
    this.assertCreateLead(input);
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key: idempotencyKey, payload: input, scope: "intake.create-lead" },
      async (transaction) => {
        const duplicateWarnings = await this.findDuplicateWarnings(transaction, actor.tenantId, {
          ...(input.customer?.displayName ? { customerName: input.customer.displayName } : {}),
          ...(input.primaryContact?.email ? { email: input.primaryContact.email } : {}),
          ...(input.primaryContact?.phone ? { phone: input.primaryContact.phone } : {}),
          ...(input.serviceLocation ? { serviceLocation: input.serviceLocation } : {}),
        });
        const customer = await this.resolveCustomer(transaction, actor, input);
        const contact = await this.resolveContact(transaction, actor, input);
        await transaction
          .insert(accountContacts)
          .values({
            contactId: contact.id,
            createdBy: actor.userId,
            customerAccountId: customer.id,
            isPrimary: input.customerAccountId === undefined,
            role: "primary",
            tenantId: actor.tenantId,
          })
          .onConflictDoNothing();
        const location = await this.resolveLocation(transaction, actor, customer.id, input);
        await transaction
          .insert(locationContacts)
          .values({
            contactId: contact.id,
            createdBy: actor.userId,
            role: "site",
            serviceLocationId: location.id,
            tenantId: actor.tenantId,
          })
          .onConflictDoNothing();

        const leadId = randomUUID();
        const leadNumber = await allocateBusinessNumber(transaction, {
          entityType: "lead",
          prefix: "LEAD",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const [lead] = await transaction
          .insert(leads)
          .values({
            createdBy: actor.userId,
            customerAccountId: customer.id,
            debrisType: input.dumpTrailerRental?.debrisType.trim(),
            estimatedQuantity: input.materialDelivery?.estimatedQuantity,
            id: leadId,
            leadNumber,
            materialDescription: input.materialDelivery?.materialDescription.trim(),
            ownerUserId: actor.userId,
            primaryContactId: contact.id,
            quantityUnit: input.materialDelivery?.quantityUnit,
            rentalEndDate: input.dumpTrailerRental?.rentalEndDate,
            rentalStartDate: input.dumpTrailerRental?.rentalStartDate,
            serviceInstructions:
              input.materialDelivery?.deliveryInstructions?.trim() ??
              input.dumpTrailerRental?.deliveryInstructions?.trim(),
            serviceLocationId: location.id,
            serviceType: input.serviceType,
            source: input.source,
            summary: input.summary.trim(),
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!lead) throw new Error("Lead was not created");
        await this.recordChange(transaction, {
          actorUserId: actor.userId,
          after: { serviceType: lead.serviceType, status: lead.status },
          commandName: "CreateLead",
          entityId: lead.id,
          entityType: "Lead",
          eventType: "lead.created",
          metadata: {
            customerAccountId: customer.id,
            leadNumber,
            serviceLocationId: location.id,
          },
          tenantId: actor.tenantId,
        });
        return {
          body: {
            duplicateWarnings,
            lead: await this.loadLeadDto(transaction, actor.tenantId, lead.id),
          },
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async listCustomers(query?: string, limit = 50): Promise<CustomerListResponseDto> {
    const actor = this.context.actor();
    const safeLimit = normalizeLimit(limit);
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const normalizedQuery = query?.trim();
      const predicate = normalizedQuery
        ? and(
            eq(customerAccounts.tenantId, actor.tenantId),
            ilike(customerAccounts.displayName, `%${normalizedQuery}%`),
          )
        : eq(customerAccounts.tenantId, actor.tenantId);
      const records = await transaction
        .select()
        .from(customerAccounts)
        .where(predicate)
        .orderBy(asc(customerAccounts.displayName))
        .limit(safeLimit);
      const total = await transaction
        .select({ value: count() })
        .from(customerAccounts)
        .where(predicate);
      return { items: records.map(toCustomerDto), total: total[0]?.value ?? 0 };
    });
  }

  public async getCustomer(customerId: string): Promise<CustomerDetailDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const customer = await this.findCustomer(transaction, actor.tenantId, customerId);
      const linkedContacts = await transaction
        .select({ contact: contacts })
        .from(accountContacts)
        .innerJoin(
          contacts,
          and(
            eq(contacts.tenantId, accountContacts.tenantId),
            eq(contacts.id, accountContacts.contactId),
          ),
        )
        .where(
          and(
            eq(accountContacts.tenantId, actor.tenantId),
            eq(accountContacts.customerAccountId, customerId),
          ),
        )
        .orderBy(asc(contacts.displayName));
      const locations = await transaction
        .select()
        .from(serviceLocations)
        .where(
          and(
            eq(serviceLocations.tenantId, actor.tenantId),
            eq(serviceLocations.customerAccountId, customerId),
          ),
        )
        .orderBy(asc(serviceLocations.label));
      const leadRows = await this.selectLeadRows(transaction, actor.tenantId, {
        customerId,
        limit: 100,
      });
      const customerDto = toCustomerDto(customer);
      return {
        createdAt: customerDto.createdAt,
        contacts: linkedContacts.map(({ contact }) => toContactDto(contact)),
        customerType: customerDto.customerType,
        displayName: customerDto.displayName,
        id: customerDto.id,
        leads: leadRows.map(toLeadDto),
        preferredContactMethod: customerDto.preferredContactMethod,
        serviceLocations: locations.map(toLocationDto),
        status: customerDto.status,
      };
    });
  }

  public async listLeads(
    query?: string,
    status?: string,
    limit = 50,
  ): Promise<LeadListResponseDto> {
    if (status && !leadStatusValues.has(status)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "LEAD_STATUS_INVALID",
        "Lead status is invalid",
      );
    }
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const rows = await this.selectLeadRows(transaction, actor.tenantId, {
        limit: normalizeLimit(limit),
        ...(query ? { query } : {}),
        ...(status ? { status } : {}),
      });
      const totals = await transaction
        .select({ value: count() })
        .from(leads)
        .innerJoin(
          customerAccounts,
          and(
            eq(customerAccounts.tenantId, leads.tenantId),
            eq(customerAccounts.id, leads.customerAccountId),
          ),
        )
        .where(
          and(
            ...leadPredicates(actor.tenantId, {
              ...(query ? { query } : {}),
              ...(status ? { status } : {}),
            }),
          ),
        );
      return { items: rows.map(toLeadDto), total: totals[0]?.value ?? 0 };
    });
  }

  public async getLead(leadId: string): Promise<LeadDetailDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, (transaction) =>
      this.loadLeadDetail(transaction, actor.tenantId, leadId),
    );
  }

  public async addNote(
    leadId: string,
    input: CreateLeadNoteDto,
    idempotencyKey: string,
  ): Promise<LeadNoteDto> {
    const body = input.body.trim();
    if (!body) throw invalidInput("LEAD_NOTE_INVALID", "Lead note cannot be empty");
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { body, leadId, visibility: input.visibility },
        scope: "leads.add-note",
      },
      async (transaction) => {
        await this.findLead(transaction, actor.tenantId, leadId);
        const [note] = await transaction
          .insert(leadNotes)
          .values({
            body,
            createdBy: actor.userId,
            leadId,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
            visibility: input.visibility ?? "internal",
          })
          .returning();
        if (!note) throw new Error("Lead note was not created");
        await this.recordChange(transaction, {
          actorUserId: actor.userId,
          after: { visibility: note.visibility },
          commandName: "AddLeadNote",
          entityId: leadId,
          entityType: "Lead",
          eventType: "lead.note_added",
          metadata: { noteId: note.id },
          tenantId: actor.tenantId,
        });
        return { body: toNoteDto(note), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async addTask(
    leadId: string,
    input: CreateLeadTaskDto,
    idempotencyKey: string,
  ): Promise<LeadTaskDto> {
    const title = input.title.trim();
    if (!title) throw invalidInput("LEAD_TASK_INVALID", "Lead task title cannot be empty");
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: {
          assignedUserId: input.assignedUserId,
          dueAt: input.dueAt,
          leadId,
          title,
        },
        scope: "leads.add-task",
      },
      async (transaction) => {
        await this.findLead(transaction, actor.tenantId, leadId);
        if (input.assignedUserId) {
          await this.assertTenantUser(transaction, actor.tenantId, input.assignedUserId);
        }
        const [task] = await transaction
          .insert(leadTasks)
          .values({
            assignedUserId: input.assignedUserId ?? actor.userId,
            createdBy: actor.userId,
            dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
            leadId,
            tenantId: actor.tenantId,
            title,
            updatedBy: actor.userId,
          })
          .returning();
        if (!task) throw new Error("Lead task was not created");
        await this.recordChange(transaction, {
          actorUserId: actor.userId,
          after: { status: task.status, title: task.title },
          commandName: "AddLeadTask",
          entityId: leadId,
          entityType: "Lead",
          eventType: "lead.task_added",
          metadata: { taskId: task.id },
          tenantId: actor.tenantId,
        });
        return { body: toTaskDto(task), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async completeTask(
    leadId: string,
    taskId: string,
    idempotencyKey: string,
  ): Promise<LeadTaskDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key: idempotencyKey, payload: { leadId, taskId }, scope: "leads.complete-task" },
      async (transaction) => {
        const [task] = await transaction
          .select()
          .from(leadTasks)
          .where(
            and(
              eq(leadTasks.tenantId, actor.tenantId),
              eq(leadTasks.leadId, leadId),
              eq(leadTasks.id, taskId),
            ),
          )
          .for("update");
        if (!task) throw notFound("LEAD_TASK_NOT_FOUND", "Lead task not found");
        if (task.status === "completed") {
          return { body: toTaskDto(task), status: HttpStatus.OK };
        }
        if (task.status !== "open") {
          throw invalidState("LEAD_TASK_NOT_OPEN", "Only an open Lead task can be completed");
        }
        const [updated] = await transaction
          .update(leadTasks)
          .set({ completedAt: new Date(), status: "completed", updatedBy: actor.userId })
          .where(eq(leadTasks.id, task.id))
          .returning();
        if (!updated) throw new Error("Lead task was not completed");
        await this.recordChange(transaction, {
          actorUserId: actor.userId,
          after: { status: "completed" },
          before: { status: "open" },
          commandName: "CompleteLeadTask",
          entityId: leadId,
          entityType: "Lead",
          eventType: "lead.task_completed",
          metadata: { taskId },
          tenantId: actor.tenantId,
        });
        return { body: toTaskDto(updated), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async linkDocument(
    leadId: string,
    input: LinkLeadDocumentDto,
    idempotencyKey: string,
  ): Promise<LeadDocumentDto> {
    const purpose = input.purpose.trim();
    if (!purpose) throw invalidInput("DOCUMENT_LINK_INVALID", "Document purpose cannot be empty");
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { documentId: input.documentId, leadId, purpose },
        scope: "leads.link-document",
      },
      async (transaction) => {
        await this.findLead(transaction, actor.tenantId, leadId);
        const link = await this.documents.linkAvailableToEntity(transaction, {
          actorUserId: actor.userId,
          documentId: input.documentId,
          entityId: leadId,
          entityType: "Lead",
          purpose,
          tenantId: actor.tenantId,
        });
        if (link.created) {
          await this.recordChange(transaction, {
            actorUserId: actor.userId,
            after: { documentId: link.document.id, purpose },
            commandName: "LinkLeadDocument",
            entityId: leadId,
            entityType: "Lead",
            eventType: "lead.document_linked",
            metadata: { documentId: link.document.id, purpose },
            tenantId: actor.tenantId,
          });
        }
        return {
          body: {
            id: link.document.id,
            mediaType: link.document.mediaType,
            originalFilename: link.document.originalFilename,
            purpose,
          },
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async transitionLead(
    leadId: string,
    action: LeadTransitionAction,
    input: TransitionLeadDto,
    idempotencyKey: string,
  ): Promise<LeadDetailDto> {
    const definition = transitionDefinitions[action];
    const reason = input.reason?.trim();
    if (definition.reasonRequired && !reason) {
      throw invalidInput("LEAD_REASON_REQUIRED", "A reason is required for this Lead transition");
    }
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key: idempotencyKey, payload: { action, leadId, reason }, scope: `leads.${action}` },
      async (transaction) => {
        const record = await this.findLead(transaction, actor.tenantId, leadId, true);
        if (record.status === definition.to) {
          return {
            body: await this.loadLeadDetail(transaction, actor.tenantId, leadId),
            status: HttpStatus.OK,
          };
        }
        if (!definition.from.includes(record.status)) {
          throw invalidState(
            "LEAD_TRANSITION_INVALID",
            `A Lead in ${record.status} cannot perform ${action}`,
          );
        }
        await transaction
          .update(leads)
          .set({
            closedAt: definition.reasonRequired ? new Date() : null,
            status: definition.to,
            terminalReason: definition.reasonRequired ? reason : null,
            updatedBy: actor.userId,
          })
          .where(eq(leads.id, leadId));
        await this.recordChange(transaction, {
          actorUserId: actor.userId,
          after: { status: definition.to, terminalReason: reason },
          before: { status: record.status },
          commandName: definition.commandName,
          entityId: leadId,
          entityType: "Lead",
          eventType: definition.eventType,
          tenantId: actor.tenantId,
        });
        return {
          body: await this.loadLeadDetail(transaction, actor.tenantId, leadId),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  private assertCreateLead(input: CreateIntakeLeadDto): void {
    assertExactlyOne(input.customerAccountId, input.customer, "customer");
    assertExactlyOne(input.primaryContactId, input.primaryContact, "primary contact");
    assertExactlyOne(input.serviceLocationId, input.serviceLocation, "service location");

    if (input.primaryContact) this.assertReachableContact(input.primaryContact);
    const material = input.materialDelivery;
    const rental = input.dumpTrailerRental;
    if (
      (input.serviceType === "material_delivery" && (!material || rental)) ||
      (input.serviceType === "dump_trailer_rental" && (!rental || material))
    ) {
      throw invalidInput(
        "LEAD_SERVICE_DETAILS_INVALID",
        "A Lead must contain exactly one matching service detail object",
      );
    }
    if (material && !isPositiveDecimal(material.estimatedQuantity)) {
      throw invalidInput("LEAD_QUANTITY_INVALID", "Estimated quantity must be greater than zero");
    }
    if (rental && rental.rentalEndDate < rental.rentalStartDate) {
      throw invalidInput(
        "LEAD_RENTAL_DATES_INVALID",
        "Rental end date cannot be before the start date",
      );
    }
  }

  private assertDuplicateCheck(input: DuplicateCheckDto): void {
    if (!input.customerName && !input.email && !input.phone && !input.serviceLocation) {
      throw invalidInput(
        "DUPLICATE_CHECK_EMPTY",
        "Provide a customer, contact, or service location value to check",
      );
    }
  }

  private assertReachableContact(contact: NewContactDto): void {
    const email = normalizeEmail(contact.email);
    const phone = normalizePhone(contact.phone);
    if (!email && !phone) {
      throw invalidInput(
        "CONTACT_UNREACHABLE",
        "A Contact requires an email address or phone number",
      );
    }
    if (contact.preferredContactMethod === "email" && !email) {
      throw invalidInput(
        "CONTACT_EMAIL_REQUIRED",
        "Email is required for email contact preference",
      );
    }
    if (
      (contact.preferredContactMethod === "phone" || contact.preferredContactMethod === "text") &&
      !phone
    ) {
      throw invalidInput(
        "CONTACT_PHONE_REQUIRED",
        "Phone is required for phone or text preference",
      );
    }
  }

  private async resolveCustomer(
    transaction: TenantTransaction,
    actor: { tenantId: string; userId: string },
    input: CreateIntakeLeadDto,
  ): Promise<CustomerRecord> {
    if (input.customerAccountId) {
      return this.findCustomer(transaction, actor.tenantId, input.customerAccountId);
    }
    const customer = requireValue(input.customer, "customer");
    const [created] = await transaction
      .insert(customerAccounts)
      .values({
        billingContactSummary: customer.billingContactSummary?.trim(),
        createdBy: actor.userId,
        customerType: customer.customerType,
        displayName: customer.displayName.trim(),
        normalizedName: normalizeCustomerName(customer.displayName),
        ownerUserId: actor.userId,
        preferredContactMethod: customer.preferredContactMethod,
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Customer Account was not created");
    await this.recordChange(transaction, {
      actorUserId: actor.userId,
      after: { customerType: created.customerType, status: created.status },
      commandName: "CreateCustomerAccount",
      entityId: created.id,
      entityType: "CustomerAccount",
      eventType: "customer.created",
      tenantId: actor.tenantId,
    });
    return created;
  }

  private async resolveContact(
    transaction: TenantTransaction,
    actor: { tenantId: string; userId: string },
    input: CreateIntakeLeadDto,
  ): Promise<ContactRecord> {
    if (input.primaryContactId) {
      const [contact] = await transaction
        .select()
        .from(contacts)
        .where(and(eq(contacts.tenantId, actor.tenantId), eq(contacts.id, input.primaryContactId)));
      if (!contact) throw notFound("CONTACT_NOT_FOUND", "Contact not found");
      return contact;
    }
    const contact = requireValue(input.primaryContact, "primary contact");
    const displayName = `${contact.firstName.trim()} ${contact.lastName.trim()}`;
    const [created] = await transaction
      .insert(contacts)
      .values({
        createdBy: actor.userId,
        displayName,
        email: contact.email?.trim(),
        firstName: contact.firstName.trim(),
        lastName: contact.lastName.trim(),
        normalizedEmail: normalizeEmail(contact.email),
        normalizedPhone: normalizePhone(contact.phone),
        phone: contact.phone?.trim(),
        preferredContactMethod: contact.preferredContactMethod,
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Contact was not created");
    await this.recordChange(transaction, {
      actorUserId: actor.userId,
      after: { preferredContactMethod: created.preferredContactMethod, status: created.status },
      commandName: "CreateContact",
      entityId: created.id,
      entityType: "Contact",
      eventType: "contact.created",
      tenantId: actor.tenantId,
    });
    return created;
  }

  private async resolveLocation(
    transaction: TenantTransaction,
    actor: { tenantId: string; userId: string },
    customerAccountId: string,
    input: CreateIntakeLeadDto,
  ): Promise<LocationRecord> {
    if (input.serviceLocationId) {
      const [location] = await transaction
        .select()
        .from(serviceLocations)
        .where(
          and(
            eq(serviceLocations.tenantId, actor.tenantId),
            eq(serviceLocations.customerAccountId, customerAccountId),
            eq(serviceLocations.id, input.serviceLocationId),
          ),
        );
      if (!location) throw notFound("SERVICE_LOCATION_NOT_FOUND", "Service Location not found");
      return location;
    }
    const location = requireValue(input.serviceLocation, "service location");
    const [created] = await transaction
      .insert(serviceLocations)
      .values({
        accessNotes: location.accessNotes?.trim(),
        addressLine1: location.addressLine1.trim(),
        addressLine2: location.addressLine2?.trim(),
        city: location.city.trim(),
        createdBy: actor.userId,
        customerAccountId,
        label: location.label.trim(),
        normalizedAddress: normalizeAddress(location),
        postalCode: location.postalCode.trim(),
        region: location.region.trim().toUpperCase(),
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Service Location was not created");
    await this.recordChange(transaction, {
      actorUserId: actor.userId,
      after: { customerAccountId, status: created.status },
      commandName: "CreateServiceLocation",
      entityId: created.id,
      entityType: "ServiceLocation",
      eventType: "service_location.created",
      tenantId: actor.tenantId,
    });
    return created;
  }

  private async findDuplicateWarnings(
    transaction: TenantTransaction,
    tenantId: string,
    input: DuplicateCheckDto,
  ): Promise<DuplicateWarningDto[]> {
    const warnings: DuplicateWarningDto[] = [];
    const normalizedName = input.customerName
      ? normalizeCustomerName(input.customerName)
      : undefined;
    if (normalizedName) {
      const matches = await transaction
        .select({ display: customerAccounts.displayName, id: customerAccounts.id })
        .from(customerAccounts)
        .where(
          and(
            eq(customerAccounts.tenantId, tenantId),
            eq(customerAccounts.normalizedName, normalizedName),
          ),
        )
        .limit(5);
      warnings.push(
        ...matches.map((match) => ({
          code: "customer_name",
          display: match.display,
          entityId: match.id,
          entityType: "CustomerAccount",
        })),
      );
    }
    const normalizedEmail = normalizeEmail(input.email);
    if (normalizedEmail) {
      const matches = await transaction
        .select({ display: contacts.displayName, id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.normalizedEmail, normalizedEmail)))
        .limit(5);
      warnings.push(
        ...matches.map((match) => ({
          code: "contact_email",
          display: match.display,
          entityId: match.id,
          entityType: "Contact",
        })),
      );
    }
    const normalizedPhone = normalizePhone(input.phone);
    if (normalizedPhone) {
      const matches = await transaction
        .select({ display: contacts.displayName, id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.normalizedPhone, normalizedPhone)))
        .limit(5);
      warnings.push(
        ...matches.map((match) => ({
          code: "contact_phone",
          display: match.display,
          entityId: match.id,
          entityType: "Contact",
        })),
      );
    }
    if (input.serviceLocation) {
      const normalized = normalizeAddress(input.serviceLocation);
      const matches = await transaction
        .select({ display: serviceLocations.label, id: serviceLocations.id })
        .from(serviceLocations)
        .where(
          and(
            eq(serviceLocations.tenantId, tenantId),
            eq(serviceLocations.normalizedAddress, normalized),
          ),
        )
        .limit(5);
      warnings.push(
        ...matches.map((match) => ({
          code: "service_address",
          display: match.display,
          entityId: match.id,
          entityType: "ServiceLocation",
        })),
      );
    }
    return deduplicateWarnings(warnings);
  }

  private async findCustomer(
    transaction: TenantTransaction,
    tenantId: string,
    customerId: string,
  ): Promise<CustomerRecord> {
    const [customer] = await transaction
      .select()
      .from(customerAccounts)
      .where(and(eq(customerAccounts.tenantId, tenantId), eq(customerAccounts.id, customerId)));
    if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer Account not found");
    return customer;
  }

  private async findLead(
    transaction: TenantTransaction,
    tenantId: string,
    leadId: string,
    lock = false,
  ): Promise<LeadRecord> {
    const query = transaction
      .select()
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
    const records = lock ? await query.for("update") : await query;
    const record = records[0];
    if (!record) throw notFound("LEAD_NOT_FOUND", "Lead not found");
    return record;
  }

  private async assertTenantUser(
    transaction: TenantTransaction,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const [user] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
    if (!user) throw notFound("USER_NOT_FOUND", "Assigned user not found");
  }

  private async selectLeadRows(
    transaction: TenantTransaction,
    tenantId: string,
    input: { customerId?: string; limit: number; query?: string; status?: string },
  ): Promise<LeadRow[]> {
    const predicates = leadPredicates(tenantId, input);
    return transaction
      .select({
        contact: contacts,
        customer: customerAccounts,
        lead: leads,
        location: serviceLocations,
      })
      .from(leads)
      .innerJoin(
        customerAccounts,
        and(
          eq(customerAccounts.tenantId, leads.tenantId),
          eq(customerAccounts.id, leads.customerAccountId),
        ),
      )
      .innerJoin(
        contacts,
        and(eq(contacts.tenantId, leads.tenantId), eq(contacts.id, leads.primaryContactId)),
      )
      .innerJoin(
        serviceLocations,
        and(
          eq(serviceLocations.tenantId, leads.tenantId),
          eq(serviceLocations.id, leads.serviceLocationId),
        ),
      )
      .where(and(...predicates))
      .orderBy(desc(leads.createdAt))
      .limit(input.limit);
  }

  private async loadLeadDto(
    transaction: TenantTransaction,
    tenantId: string,
    leadId: string,
  ): Promise<LeadDto> {
    const [exact] = await transaction
      .select({
        contact: contacts,
        customer: customerAccounts,
        lead: leads,
        location: serviceLocations,
      })
      .from(leads)
      .innerJoin(
        customerAccounts,
        and(
          eq(customerAccounts.tenantId, leads.tenantId),
          eq(customerAccounts.id, leads.customerAccountId),
        ),
      )
      .innerJoin(
        contacts,
        and(eq(contacts.tenantId, leads.tenantId), eq(contacts.id, leads.primaryContactId)),
      )
      .innerJoin(
        serviceLocations,
        and(
          eq(serviceLocations.tenantId, leads.tenantId),
          eq(serviceLocations.id, leads.serviceLocationId),
        ),
      )
      .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
    if (!exact) throw notFound("LEAD_NOT_FOUND", "Lead not found");
    return toLeadDto(exact);
  }

  private async loadLeadDetail(
    transaction: TenantTransaction,
    tenantId: string,
    leadId: string,
  ): Promise<LeadDetailDto> {
    const base = await this.loadLeadDto(transaction, tenantId, leadId);
    const notes = await transaction
      .select()
      .from(leadNotes)
      .where(and(eq(leadNotes.tenantId, tenantId), eq(leadNotes.leadId, leadId)))
      .orderBy(desc(leadNotes.createdAt));
    const tasks = await transaction
      .select()
      .from(leadTasks)
      .where(and(eq(leadTasks.tenantId, tenantId), eq(leadTasks.leadId, leadId)))
      .orderBy(asc(leadTasks.status), asc(leadTasks.dueAt), desc(leadTasks.createdAt));
    const linkedDocuments = await this.documents.listEntityDocuments(transaction, {
      entityId: leadId,
      entityType: "Lead",
      tenantId,
    });
    const timeline = await transaction
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenantId),
          eq(auditEvents.entityType, "Lead"),
          eq(auditEvents.entityId, leadId),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt));
    return {
      createdAt: base.createdAt,
      customer: base.customer,
      documents: linkedDocuments.map(({ document, purpose }) => ({
        id: document.id,
        mediaType: document.mediaType,
        originalFilename: document.originalFilename,
        purpose,
      })),
      dumpTrailerRental: base.dumpTrailerRental,
      id: base.id,
      leadNumber: base.leadNumber,
      materialDelivery: base.materialDelivery,
      notes: notes.map(toNoteDto),
      primaryContact: base.primaryContact,
      serviceLocation: base.serviceLocation,
      serviceType: base.serviceType,
      source: base.source,
      status: base.status,
      summary: base.summary,
      tasks: tasks.map(toTaskDto),
      terminalReason: base.terminalReason,
      timeline: timeline.map((event) => ({
        eventType: event.eventType,
        id: event.id,
        metadata: event.metadata,
        occurredAt: event.occurredAt.toISOString(),
      })),
      updatedAt: base.updatedAt,
    };
  }

  private async recordChange(
    transaction: TenantTransaction,
    input: {
      actorUserId: string;
      after: unknown;
      before?: unknown;
      commandName: string;
      entityId: string;
      entityType: string;
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
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: eventId,
      metadata: input.metadata ?? {},
      tenantId: input.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.entityId,
      aggregateType: input.entityType,
      createdBy: input.actorUserId,
      eventType: input.eventType,
      payload: { entityId: input.entityId, eventId, ...(input.metadata ?? {}) },
      tenantId: input.tenantId,
      updatedBy: input.actorUserId,
    });
  }
}

interface LeadRow {
  contact: ContactRecord;
  customer: CustomerRecord;
  lead: LeadRecord;
  location: LocationRecord;
}

function leadPredicates(
  tenantId: string,
  input: { customerId?: string; query?: string; status?: string },
): SQL[] {
  const predicates: SQL[] = [eq(leads.tenantId, tenantId)];
  if (input.customerId) predicates.push(eq(leads.customerAccountId, input.customerId));
  if (input.status) predicates.push(eq(leads.status, input.status));
  const search = input.query?.trim();
  if (search) {
    const searchPredicate = or(
      ilike(leads.leadNumber, `%${search}%`),
      ilike(leads.summary, `%${search}%`),
      ilike(customerAccounts.displayName, `%${search}%`),
    );
    if (searchPredicate) predicates.push(searchPredicate);
  }
  return predicates;
}

function toCustomerDto(record: CustomerRecord): CustomerAccountDto {
  return {
    createdAt: record.createdAt.toISOString(),
    customerType: record.customerType,
    displayName: record.displayName,
    id: record.id,
    preferredContactMethod: record.preferredContactMethod,
    status: record.status,
  };
}

function toContactDto(record: ContactRecord): ContactDto {
  return {
    displayName: record.displayName,
    email: record.email,
    id: record.id,
    phone: record.phone,
    preferredContactMethod: record.preferredContactMethod,
  };
}

function toLocationDto(record: LocationRecord): ServiceLocationDto {
  return {
    accessNotes: record.accessNotes,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    id: record.id,
    label: record.label,
    postalCode: record.postalCode,
    region: record.region,
  };
}

function toLeadDto(row: LeadRow): LeadDto {
  const materialDelivery =
    row.lead.serviceType === "material_delivery" &&
    row.lead.materialDescription &&
    row.lead.estimatedQuantity &&
    row.lead.quantityUnit
      ? {
          ...(row.lead.serviceInstructions
            ? { deliveryInstructions: row.lead.serviceInstructions }
            : {}),
          estimatedQuantity: row.lead.estimatedQuantity,
          materialDescription: row.lead.materialDescription,
          quantityUnit: row.lead.quantityUnit as "tons" | "cubic_yards" | "loads",
        }
      : null;
  const dumpTrailerRental =
    row.lead.serviceType === "dump_trailer_rental" &&
    row.lead.rentalStartDate &&
    row.lead.rentalEndDate &&
    row.lead.debrisType
      ? {
          debrisType: row.lead.debrisType,
          ...(row.lead.serviceInstructions
            ? { deliveryInstructions: row.lead.serviceInstructions }
            : {}),
          rentalEndDate: row.lead.rentalEndDate,
          rentalStartDate: row.lead.rentalStartDate,
        }
      : null;
  if (!materialDelivery && !dumpTrailerRental) {
    throw new Error("Lead service details do not match the API contract");
  }
  return {
    createdAt: row.lead.createdAt.toISOString(),
    customer: toCustomerDto(row.customer),
    dumpTrailerRental,
    id: row.lead.id,
    leadNumber: row.lead.leadNumber,
    materialDelivery,
    primaryContact: toContactDto(row.contact),
    serviceLocation: toLocationDto(row.location),
    serviceType: row.lead.serviceType,
    source: row.lead.source,
    status: row.lead.status,
    summary: row.lead.summary,
    terminalReason: row.lead.terminalReason,
    updatedAt: row.lead.updatedAt.toISOString(),
  };
}

function toNoteDto(record: typeof leadNotes.$inferSelect): LeadNoteDto {
  return {
    body: record.body,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    visibility: record.visibility,
  };
}

function toTaskDto(record: typeof leadTasks.$inferSelect): LeadTaskDto {
  return {
    completedAt: record.completedAt?.toISOString() ?? null,
    dueAt: record.dueAt?.toISOString() ?? null,
    id: record.id,
    status: record.status,
    title: record.title,
  };
}

function normalizeLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) return 50;
  return Math.min(value, 100);
}

function assertExactlyOne(existing: unknown, created: unknown, label: string): void {
  if (Boolean(existing) === Boolean(created)) {
    throw invalidInput("INTAKE_REFERENCE_INVALID", `Provide exactly one existing or new ${label}`);
  }
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`${label} was not provided after validation`);
  return value;
}

function isPositiveDecimal(value: string): boolean {
  const digits = value.replace(".", "").replace(/^0+/, "");
  return digits.length > 0;
}

function deduplicateWarnings(warnings: DuplicateWarningDto[]): DuplicateWarningDto[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function invalidInput(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

function invalidState(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}
