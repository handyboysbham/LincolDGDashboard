import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  assets,
  auditEvents,
  checklistTemplateItems,
  checklistTemplates,
  companyPaymentAccounts,
  customerAccounts,
  invoices,
  jobs,
  outboxEvents,
  payments,
  projects,
  roles,
  supplierLocations,
  suppliers,
  userRoles,
  users,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, desc, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import type {
  AdministrationAuditEventDto,
  AdministrationAuditEventListDto,
  AdministrationRoleDto,
  AdministrationSearchDto,
  AdministrationSearchResultDto,
  AdministrationSupplierDto,
  AdministrationUserDto,
  AdministrationWorkspaceDto,
  AssignUserRoleDto,
  ChecklistTemplateDto,
  CompanyPaymentAccountDto,
  CreateChecklistTemplateDto,
  CreateCompanyPaymentAccountDto,
  CreateSupplierDto,
  CreateSupplierFacilityDto,
  LinkUserIdentityDto,
} from "./administration.dto.js";

interface Actor {
  tenantId: string;
  userId: string;
}

@Injectable()
export class AdministrationService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
  ) {}

  public async workspace(): Promise<AdministrationWorkspaceDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const [
        userRows,
        roleRows,
        assignmentRows,
        assetRows,
        supplierRows,
        facilityRows,
        accountRows,
        templateRows,
        itemRows,
        auditRows,
        openJobCount,
        pastDueInvoiceCount,
      ] = await Promise.all([
        transaction
          .select()
          .from(users)
          .where(eq(users.tenantId, actor.tenantId))
          .orderBy(users.displayName),
        transaction
          .select()
          .from(roles)
          .where(eq(roles.tenantId, actor.tenantId))
          .orderBy(roles.name),
        transaction
          .select({ roleId: userRoles.roleId, userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.tenantId, actor.tenantId)),
        transaction
          .select()
          .from(assets)
          .where(eq(assets.tenantId, actor.tenantId))
          .orderBy(assets.assetNumber),
        transaction
          .select()
          .from(suppliers)
          .where(eq(suppliers.tenantId, actor.tenantId))
          .orderBy(suppliers.name),
        transaction
          .select()
          .from(supplierLocations)
          .where(eq(supplierLocations.tenantId, actor.tenantId))
          .orderBy(supplierLocations.label),
        transaction
          .select()
          .from(companyPaymentAccounts)
          .where(eq(companyPaymentAccounts.tenantId, actor.tenantId))
          .orderBy(companyPaymentAccounts.paymentMethod, companyPaymentAccounts.name),
        transaction
          .select()
          .from(checklistTemplates)
          .where(eq(checklistTemplates.tenantId, actor.tenantId))
          .orderBy(checklistTemplates.templateCode, desc(checklistTemplates.version)),
        transaction
          .select()
          .from(checklistTemplateItems)
          .where(eq(checklistTemplateItems.tenantId, actor.tenantId))
          .orderBy(checklistTemplateItems.checklistTemplateId, checklistTemplateItems.sequence),
        transaction
          .select({
            actorDisplayName: users.displayName,
            commandName: auditEvents.commandName,
            entityId: auditEvents.entityId,
            entityType: auditEvents.entityType,
            eventType: auditEvents.eventType,
            id: auditEvents.id,
            occurredAt: auditEvents.occurredAt,
          })
          .from(auditEvents)
          .leftJoin(
            users,
            and(eq(users.tenantId, auditEvents.tenantId), eq(users.id, auditEvents.actorUserId)),
          )
          .where(eq(auditEvents.tenantId, actor.tenantId))
          .orderBy(desc(auditEvents.occurredAt))
          .limit(40),
        transaction
          .select({ total: sql<number>`count(*)::int` })
          .from(jobs)
          .where(
            and(
              eq(jobs.tenantId, actor.tenantId),
              notInArray(jobs.status, ["closed", "cancelled"]),
            ),
          ),
        transaction
          .select({ total: sql<number>`count(*)::int` })
          .from(invoices)
          .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.status, "past_due"))),
      ]);

      const roleDtos = roleRows.map(roleDto);
      const roleById = new Map(roleDtos.map((role) => [role.id, role]));
      const rolesByUser = new Map<string, AdministrationRoleDto[]>();
      for (const assignment of assignmentRows) {
        const role = roleById.get(assignment.roleId);
        if (!role) continue;
        const assigned = rolesByUser.get(assignment.userId) ?? [];
        assigned.push(role);
        rolesByUser.set(assignment.userId, assigned);
      }

      const usersDto: AdministrationUserDto[] = userRows.map((user) => ({
        displayName: user.displayName,
        email: user.email,
        id: user.id,
        identityLinked: user.externalSubject !== null,
        roles: (rolesByUser.get(user.id) ?? []).toSorted((left, right) =>
          left.name.localeCompare(right.name),
        ),
        status: user.status,
      }));
      const suppliersDto: AdministrationSupplierDto[] = supplierRows.map((supplier) => ({
        facilities: facilityRows
          .filter((facility) => facility.supplierId === supplier.id)
          .map((facility) => ({
            addressSummary: facility.addressSummary,
            id: facility.id,
            label: facility.label,
            status: facility.status,
          })),
        id: supplier.id,
        name: supplier.name,
        status: supplier.status,
      }));
      const checklistDtos = templateRows.map((template) =>
        checklistTemplateDto(
          template,
          itemRows.filter((item) => item.checklistTemplateId === template.id),
        ),
      );

      return {
        assets: assetRows.map((asset) => ({
          assetNumber: asset.assetNumber,
          assetType: asset.assetType,
          id: asset.id,
          name: asset.name,
          status: asset.status,
        })),
        checklistTemplates: checklistDtos,
        overview: {
          assets: {
            attention: assetRows.filter((asset) => asset.status === "out_of_service").length,
            total: assetRows.length,
          },
          checklistTemplates: {
            attention: templateRows.filter((template) => template.status === "draft").length,
            total: templateRows.length,
          },
          openJobs: openJobCount[0]?.total ?? 0,
          pastDueInvoices: pastDueInvoiceCount[0]?.total ?? 0,
          paymentAccounts: {
            attention: accountRows.filter((account) => account.status !== "active").length,
            total: accountRows.length,
          },
          suppliers: {
            attention: supplierRows.filter((supplier) => supplier.status !== "active").length,
            total: supplierRows.length,
          },
          users: {
            attention: userRows.filter((user) => user.status !== "active").length,
            total: userRows.length,
          },
        },
        paymentAccounts: accountRows.map(companyPaymentAccountDto),
        recentAuditEvents: auditRows.map(auditEventDto),
        roles: roleDtos,
        suppliers: suppliersDto,
        users: usersDto,
      };
    });
  }

  public async search(rawQuery: string): Promise<AdministrationSearchDto> {
    const actor = this.context.actor();
    const query = rawQuery.trim();
    if (query.length < 2) return { items: [], query };
    const pattern = `%${escapeLike(query)}%`;
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const [customerRows, projectRows, jobRows, invoiceRows, paymentRows] = await Promise.all([
        transaction
          .select()
          .from(customerAccounts)
          .where(
            and(
              eq(customerAccounts.tenantId, actor.tenantId),
              ilike(customerAccounts.displayName, pattern),
            ),
          )
          .orderBy(customerAccounts.displayName)
          .limit(5),
        transaction
          .select()
          .from(projects)
          .where(and(eq(projects.tenantId, actor.tenantId), ilike(projects.projectNumber, pattern)))
          .orderBy(desc(projects.createdAt))
          .limit(5),
        transaction
          .select()
          .from(jobs)
          .where(and(eq(jobs.tenantId, actor.tenantId), ilike(jobs.jobNumber, pattern)))
          .orderBy(desc(jobs.createdAt))
          .limit(5),
        transaction
          .select()
          .from(invoices)
          .where(and(eq(invoices.tenantId, actor.tenantId), ilike(invoices.invoiceNumber, pattern)))
          .orderBy(desc(invoices.createdAt))
          .limit(5),
        transaction
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, actor.tenantId),
              or(
                ilike(payments.paymentNumber, pattern),
                ilike(payments.receivingAccountReference, pattern),
              ),
            ),
          )
          .orderBy(desc(payments.receivedAt))
          .limit(5),
      ]);
      const items: AdministrationSearchResultDto[] = [
        ...customerRows.map((record) => ({
          id: record.id,
          path: `/customers/${record.id}`,
          primaryLabel: record.displayName,
          secondaryLabel: record.customerType === "business" ? "Business customer" : "Customer",
          status: record.status,
          type: "customer",
        })),
        ...projectRows.map((record) => ({
          id: record.id,
          path: `/projects/${record.id}`,
          primaryLabel: record.projectNumber,
          secondaryLabel: serviceLabel(record.serviceType),
          status: record.status,
          type: "project",
        })),
        ...jobRows.map((record) => ({
          id: record.id,
          path: `/jobs/${record.id}`,
          primaryLabel: record.jobNumber,
          secondaryLabel: serviceLabel(record.serviceType),
          status: record.status,
          type: "job",
        })),
        ...invoiceRows.map((record) => ({
          id: record.id,
          path: `/billing/invoices/${record.id}`,
          primaryLabel: record.invoiceNumber,
          secondaryLabel: `${titleCase(record.invoiceType)} invoice`,
          status: record.status,
          type: "invoice",
        })),
        ...paymentRows.map((record) => ({
          id: record.id,
          path: `/billing/payments/${record.id}`,
          primaryLabel: record.paymentNumber,
          secondaryLabel: `${titleCase(record.paymentMethod)} · ${record.receivingAccountReference}`,
          status: record.status,
          type: "payment",
        })),
      ];
      return { items: items.slice(0, 20), query };
    });
  }

  public async listAuditEvents(input: {
    entityType?: string;
    eventType?: string;
    limit?: number;
  }): Promise<AdministrationAuditEventListDto> {
    const actor = this.context.actor();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const conditions = [eq(auditEvents.tenantId, actor.tenantId)];
      if (input.entityType?.trim()) {
        conditions.push(eq(auditEvents.entityType, input.entityType.trim()));
      }
      if (input.eventType?.trim()) {
        conditions.push(eq(auditEvents.eventType, input.eventType.trim()));
      }
      const records = await transaction
        .select({
          actorDisplayName: users.displayName,
          commandName: auditEvents.commandName,
          entityId: auditEvents.entityId,
          entityType: auditEvents.entityType,
          eventType: auditEvents.eventType,
          id: auditEvents.id,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .leftJoin(
          users,
          and(eq(users.tenantId, auditEvents.tenantId), eq(users.id, auditEvents.actorUserId)),
        )
        .where(and(...conditions))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(limit);
      return { items: records.map(auditEventDto) };
    });
  }

  public async createPaymentAccount(
    input: CreateCompanyPaymentAccountDto,
    key: string,
  ): Promise<CompanyPaymentAccountDto> {
    const actor = this.context.actor();
    const normalized = {
      accountReference: requireText(input.accountReference, "account reference"),
      code: input.code.trim().toLowerCase(),
      instructions: optionalText(input.instructions),
      isDefault: input.isDefault ?? false,
      name: requireText(input.name, "name"),
      paymentMethod: input.paymentMethod,
    };
    const result = await this.idempotency.execute(
      { key, payload: normalized, scope: "administration.payment-accounts.create" },
      async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${actor.tenantId}:payment-account:${normalized.paymentMethod}`}))`,
        );
        const previousDefaults = normalized.isDefault
          ? await transaction
              .select()
              .from(companyPaymentAccounts)
              .where(
                and(
                  eq(companyPaymentAccounts.tenantId, actor.tenantId),
                  eq(companyPaymentAccounts.paymentMethod, normalized.paymentMethod),
                  eq(companyPaymentAccounts.isDefault, true),
                  eq(companyPaymentAccounts.status, "active"),
                ),
              )
              .for("update")
          : [];
        if (previousDefaults.length > 0) {
          await transaction
            .update(companyPaymentAccounts)
            .set({ isDefault: false, updatedBy: actor.userId })
            .where(
              inArray(
                companyPaymentAccounts.id,
                previousDefaults.map((account) => account.id),
              ),
            );
        }
        const [created] = await transaction
          .insert(companyPaymentAccounts)
          .values({
            ...normalized,
            createdBy: actor.userId,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Company Payment Account was not created");
        for (const previous of previousDefaults) {
          await this.recordChange(transaction, actor, {
            after: { isDefault: false, status: previous.status },
            before: { isDefault: true, status: previous.status },
            commandName: "CreateCompanyPaymentAccount",
            entityId: previous.id,
            entityType: "CompanyPaymentAccount",
            eventType: "administration.payment_account_default_replaced",
            metadata: { replacementAccountId: created.id },
          });
        }
        await this.recordChange(transaction, actor, {
          after: {
            code: created.code,
            isDefault: created.isDefault,
            paymentMethod: created.paymentMethod,
            status: created.status,
          },
          commandName: "CreateCompanyPaymentAccount",
          entityId: created.id,
          entityType: "CompanyPaymentAccount",
          eventType: "administration.payment_account_created",
        });
        return { body: companyPaymentAccountDto(created), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async transitionPaymentAccount(
    accountId: string,
    action: "activate" | "deactivate",
    key: string,
  ): Promise<CompanyPaymentAccountDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { accountId, action },
        scope: "administration.payment-accounts.transition",
      },
      async (transaction) => {
        const [account] = await transaction
          .select()
          .from(companyPaymentAccounts)
          .where(
            and(
              eq(companyPaymentAccounts.tenantId, actor.tenantId),
              eq(companyPaymentAccounts.id, accountId),
            ),
          )
          .for("update");
        if (!account) throw notFound("PAYMENT_ACCOUNT_NOT_FOUND", "Payment account was not found");
        const nextStatus = action === "activate" ? "active" : "inactive";
        if (account.status === nextStatus)
          return { body: companyPaymentAccountDto(account), status: 200 };
        const [updated] = await transaction
          .update(companyPaymentAccounts)
          .set({
            ...(nextStatus === "inactive" ? { isDefault: false } : {}),
            status: nextStatus,
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(companyPaymentAccounts.tenantId, actor.tenantId),
              eq(companyPaymentAccounts.id, account.id),
              eq(companyPaymentAccounts.status, account.status),
            ),
          )
          .returning();
        if (!updated)
          throw conflict(
            "PAYMENT_ACCOUNT_CHANGED",
            "Payment account changed before the action completed",
          );
        await this.recordChange(transaction, actor, {
          after: { isDefault: updated.isDefault, status: updated.status },
          before: { isDefault: account.isDefault, status: account.status },
          commandName: `${titleCase(action)}CompanyPaymentAccount`,
          entityId: updated.id,
          entityType: "CompanyPaymentAccount",
          eventType: `administration.payment_account_${action}d`,
        });
        return { body: companyPaymentAccountDto(updated), status: 200 };
      },
    );
    return result.body;
  }

  public async createChecklistTemplate(
    input: CreateChecklistTemplateDto,
    key: string,
  ): Promise<ChecklistTemplateDto> {
    const actor = this.context.actor();
    const normalized = normalizeChecklist(input);
    const result = await this.idempotency.execute(
      { key, payload: normalized, scope: "administration.checklist-templates.create" },
      async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${actor.tenantId}:checklist:${normalized.templateCode}`}))`,
        );
        const [latest] = await transaction
          .select({ version: checklistTemplates.version })
          .from(checklistTemplates)
          .where(
            and(
              eq(checklistTemplates.tenantId, actor.tenantId),
              eq(checklistTemplates.templateCode, normalized.templateCode),
            ),
          )
          .orderBy(desc(checklistTemplates.version))
          .limit(1);
        const [created] = await transaction
          .insert(checklistTemplates)
          .values({
            createdBy: actor.userId,
            name: normalized.name,
            required: normalized.required,
            serviceType: normalized.serviceType,
            templateCode: normalized.templateCode,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
            version: (latest?.version ?? 0) + 1,
          })
          .returning();
        if (!created) throw new Error("Checklist Template was not created");
        const createdItems = normalized.items.length
          ? await transaction
              .insert(checklistTemplateItems)
              .values(
                normalized.items.map((item) => ({
                  ...item,
                  checklistTemplateId: created.id,
                  createdBy: actor.userId,
                  tenantId: actor.tenantId,
                  updatedBy: actor.userId,
                })),
              )
              .returning()
          : [];
        await this.recordChange(transaction, actor, {
          after: {
            itemCount: createdItems.length,
            status: created.status,
            templateCode: created.templateCode,
            version: created.version,
          },
          commandName: "CreateChecklistTemplate",
          entityId: created.id,
          entityType: "ChecklistTemplate",
          eventType: "administration.checklist_template_created",
        });
        return {
          body: checklistTemplateDto(created, createdItems),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async publishChecklistTemplate(
    templateId: string,
    key: string,
  ): Promise<ChecklistTemplateDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { templateId },
        scope: "administration.checklist-templates.publish",
      },
      async (transaction) => {
        const [template] = await transaction
          .select()
          .from(checklistTemplates)
          .where(
            and(
              eq(checklistTemplates.tenantId, actor.tenantId),
              eq(checklistTemplates.id, templateId),
            ),
          )
          .for("update");
        if (!template)
          throw notFound("CHECKLIST_TEMPLATE_NOT_FOUND", "Checklist Template was not found");
        if (template.status !== "draft") {
          throw conflict(
            "CHECKLIST_TEMPLATE_NOT_DRAFT",
            "Only a draft Checklist Template can be published",
          );
        }
        const items = await transaction
          .select()
          .from(checklistTemplateItems)
          .where(
            and(
              eq(checklistTemplateItems.tenantId, actor.tenantId),
              eq(checklistTemplateItems.checklistTemplateId, template.id),
            ),
          )
          .orderBy(checklistTemplateItems.sequence);
        if (items.length === 0) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "CHECKLIST_TEMPLATE_EMPTY",
            "A Checklist Template needs at least one item before publication",
          );
        }
        const now = new Date();
        const previousPublished = await transaction
          .select()
          .from(checklistTemplates)
          .where(
            and(
              eq(checklistTemplates.tenantId, actor.tenantId),
              eq(checklistTemplates.templateCode, template.templateCode),
              eq(checklistTemplates.status, "published"),
            ),
          )
          .for("update");
        if (previousPublished.length > 0) {
          await transaction
            .update(checklistTemplates)
            .set({ retiredAt: now, status: "retired", updatedBy: actor.userId })
            .where(
              inArray(
                checklistTemplates.id,
                previousPublished.map((record) => record.id),
              ),
            );
        }
        const [published] = await transaction
          .update(checklistTemplates)
          .set({ publishedAt: now, status: "published", updatedBy: actor.userId })
          .where(
            and(
              eq(checklistTemplates.tenantId, actor.tenantId),
              eq(checklistTemplates.id, template.id),
              eq(checklistTemplates.status, "draft"),
            ),
          )
          .returning();
        if (!published)
          throw conflict(
            "CHECKLIST_TEMPLATE_CHANGED",
            "Checklist Template changed before publication",
          );
        for (const previous of previousPublished) {
          await this.recordChange(transaction, actor, {
            after: { status: "retired" },
            before: { status: previous.status },
            commandName: "PublishChecklistTemplate",
            entityId: previous.id,
            entityType: "ChecklistTemplate",
            eventType: "administration.checklist_template_retired",
            metadata: { replacementTemplateId: published.id },
          });
        }
        await this.recordChange(transaction, actor, {
          after: { itemCount: items.length, status: published.status },
          before: { status: template.status },
          commandName: "PublishChecklistTemplate",
          entityId: published.id,
          entityType: "ChecklistTemplate",
          eventType: "administration.checklist_template_published",
        });
        return { body: checklistTemplateDto(published, items), status: 200 };
      },
    );
    return result.body;
  }

  public async transitionUser(
    userId: string,
    action: "activate" | "deactivate",
    key: string,
  ): Promise<AdministrationUserDto> {
    const actor = this.context.actor();
    if (action === "deactivate" && userId === actor.userId) {
      throw conflict("USER_SELF_DEACTIVATION_FORBIDDEN", "You cannot deactivate your own user");
    }
    const result = await this.idempotency.execute(
      { key, payload: { action, userId }, scope: "administration.users.transition" },
      async (transaction) => {
        const [user] = await transaction
          .select()
          .from(users)
          .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, userId)))
          .for("update");
        if (!user) throw notFound("USER_NOT_FOUND", "User was not found");
        const nextStatus = action === "activate" ? "active" : "inactive";
        if (nextStatus === "inactive" && user.status === "active") {
          const [targetOwnerRole] = await transaction
            .select({ roleId: roles.id })
            .from(userRoles)
            .innerJoin(
              roles,
              and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)),
            )
            .where(
              and(
                eq(userRoles.tenantId, actor.tenantId),
                eq(userRoles.userId, user.id),
                eq(roles.code, "owner"),
                eq(roles.status, "active"),
              ),
            )
            .limit(1);
          if (targetOwnerRole) {
            const [ownerCount] = await transaction
              .select({ total: sql<number>`count(distinct ${userRoles.userId})::int` })
              .from(userRoles)
              .innerJoin(
                roles,
                and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)),
              )
              .innerJoin(
                users,
                and(eq(users.tenantId, userRoles.tenantId), eq(users.id, userRoles.userId)),
              )
              .where(
                and(
                  eq(userRoles.tenantId, actor.tenantId),
                  eq(roles.code, "owner"),
                  eq(roles.status, "active"),
                  eq(users.status, "active"),
                ),
              );
            if ((ownerCount?.total ?? 0) <= 1) {
              throw conflict(
                "LAST_OWNER_USER_REQUIRED",
                "The last active owner User cannot be deactivated",
              );
            }
          }
        }
        const updated =
          user.status === nextStatus
            ? user
            : (
                await transaction
                  .update(users)
                  .set({ status: nextStatus, updatedBy: actor.userId })
                  .where(
                    and(
                      eq(users.tenantId, actor.tenantId),
                      eq(users.id, user.id),
                      eq(users.status, user.status),
                    ),
                  )
                  .returning()
              )[0];
        if (!updated) throw conflict("USER_CHANGED", "User changed before the action completed");
        if (user.status !== updated.status) {
          await this.recordChange(transaction, actor, {
            after: { status: updated.status },
            before: { status: user.status },
            commandName: `${titleCase(action)}User`,
            entityId: updated.id,
            entityType: "User",
            eventType: `administration.user_${action}d`,
          });
        }
        return {
          body: {
            ...userBaseDto(updated),
            roles: await this.rolesForUser(transaction, actor, userId),
          },
          status: 200,
        };
      },
    );
    return result.body;
  }

  public async changeUserRole(
    userId: string,
    input: AssignUserRoleDto,
    action: "assign" | "revoke",
    key: string,
  ): Promise<AdministrationUserDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { action, roleId: input.roleId, userId },
        scope: "administration.users.roles.change",
      },
      async (transaction) => {
        const [user] = await transaction
          .select()
          .from(users)
          .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, userId)))
          .for("update");
        if (!user) throw notFound("USER_NOT_FOUND", "User was not found");
        const [role] = await transaction
          .select()
          .from(roles)
          .where(and(eq(roles.tenantId, actor.tenantId), eq(roles.id, input.roleId)));
        if (!role) throw notFound("ROLE_NOT_FOUND", "Role was not found");
        if (action === "assign" && role.status !== "active") {
          throw conflict("ROLE_INACTIVE", "An inactive Role cannot be assigned");
        }
        const existing = await transaction
          .select({ roleId: userRoles.roleId })
          .from(userRoles)
          .where(
            and(
              eq(userRoles.tenantId, actor.tenantId),
              eq(userRoles.userId, userId),
              eq(userRoles.roleId, role.id),
            ),
          );
        const shouldChange = action === "assign" ? existing.length === 0 : existing.length > 0;
        if (shouldChange && action === "revoke" && role.code === "owner") {
          const [ownerCount] = await transaction
            .select({ total: sql<number>`count(distinct ${userRoles.userId})::int` })
            .from(userRoles)
            .innerJoin(
              roles,
              and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)),
            )
            .innerJoin(
              users,
              and(eq(users.tenantId, userRoles.tenantId), eq(users.id, userRoles.userId)),
            )
            .where(
              and(
                eq(userRoles.tenantId, actor.tenantId),
                eq(roles.code, "owner"),
                eq(roles.status, "active"),
                eq(users.status, "active"),
              ),
            );
          if ((ownerCount?.total ?? 0) <= 1) {
            throw conflict(
              "LAST_OWNER_ROLE_REQUIRED",
              "The last active owner Role assignment cannot be revoked",
            );
          }
        }
        if (shouldChange && action === "assign") {
          await transaction.insert(userRoles).values({
            createdBy: actor.userId,
            roleId: role.id,
            tenantId: actor.tenantId,
            userId,
          });
        } else if (shouldChange) {
          await transaction
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.tenantId, actor.tenantId),
                eq(userRoles.userId, userId),
                eq(userRoles.roleId, role.id),
              ),
            );
        }
        if (shouldChange) {
          await this.recordChange(transaction, actor, {
            after: { assigned: action === "assign", roleCode: role.code },
            before: { assigned: action !== "assign", roleCode: role.code },
            commandName: `${titleCase(action)}UserRole`,
            entityId: user.id,
            entityType: "User",
            eventType: `administration.user_role_${action === "assign" ? "assigned" : "revoked"}`,
            metadata: { roleId: role.id },
          });
        }
        return {
          body: {
            ...userBaseDto(user),
            roles: await this.rolesForUser(transaction, actor, userId),
          },
          status: 200,
        };
      },
    );
    return result.body;
  }

  public async linkUserIdentity(
    userId: string,
    input: LinkUserIdentityDto,
    key: string,
  ): Promise<AdministrationUserDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { externalSubject: input.externalSubject, userId },
        scope: "administration.users.identity.link",
      },
      async (transaction) => {
        const [user] = await transaction
          .select()
          .from(users)
          .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, userId)))
          .for("update");
        if (!user) throw notFound("USER_NOT_FOUND", "User was not found");
        if (user.externalSubject && user.externalSubject !== input.externalSubject) {
          throw conflict(
            "USER_IDENTITY_ALREADY_LINKED",
            "The User is already linked to a different authentication identity",
          );
        }
        const [subjectOwner] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.tenantId, actor.tenantId),
              eq(users.externalSubject, input.externalSubject),
            ),
          )
          .limit(1);
        if (subjectOwner && subjectOwner.id !== user.id) {
          throw conflict(
            "AUTHENTICATION_IDENTITY_ALREADY_LINKED",
            "The authentication identity is already linked to another User",
          );
        }
        const updated =
          user.externalSubject === input.externalSubject
            ? user
            : (
                await transaction
                  .update(users)
                  .set({ externalSubject: input.externalSubject, updatedBy: actor.userId })
                  .where(
                    and(
                      eq(users.tenantId, actor.tenantId),
                      eq(users.id, user.id),
                      sql`${users.externalSubject} is null`,
                    ),
                  )
                  .returning()
              )[0];
        if (!updated)
          throw conflict("USER_CHANGED", "User changed before identity linking completed");
        if (!user.externalSubject) {
          await this.recordChange(transaction, actor, {
            after: { identityLinked: true },
            before: { identityLinked: false },
            commandName: "LinkUserIdentity",
            entityId: user.id,
            entityType: "User",
            eventType: "administration.user_identity_linked",
          });
        }
        return {
          body: {
            ...userBaseDto(updated),
            roles: await this.rolesForUser(transaction, actor, userId),
          },
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async createSupplier(
    input: CreateSupplierDto,
    key: string,
  ): Promise<AdministrationSupplierDto> {
    const actor = this.context.actor();
    const name = requireText(input.name, "supplier name");
    const normalizedName = normalizeName(name);
    const result = await this.idempotency.execute(
      { key, payload: { name, normalizedName }, scope: "administration.suppliers.create" },
      async (transaction) => {
        const [created] = await transaction
          .insert(suppliers)
          .values({
            createdBy: actor.userId,
            name,
            normalizedName,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Supplier was not created");
        await this.recordChange(transaction, actor, {
          after: { name: created.name, status: created.status },
          commandName: "CreateSupplier",
          entityId: created.id,
          entityType: "Supplier",
          eventType: "administration.supplier_created",
        });
        return {
          body: { facilities: [], id: created.id, name: created.name, status: created.status },
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async createSupplierFacility(
    supplierId: string,
    input: CreateSupplierFacilityDto,
    key: string,
  ): Promise<AdministrationSupplierDto> {
    const actor = this.context.actor();
    const normalized = {
      addressSummary: optionalText(input.addressSummary),
      label: requireText(input.label, "facility label"),
      supplierId,
    };
    const result = await this.idempotency.execute(
      { key, payload: normalized, scope: "administration.suppliers.facilities.create" },
      async (transaction) => {
        const [supplier] = await transaction
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, actor.tenantId), eq(suppliers.id, supplierId)))
          .for("update");
        if (!supplier) throw notFound("SUPPLIER_NOT_FOUND", "Supplier was not found");
        const [created] = await transaction
          .insert(supplierLocations)
          .values({
            ...normalized,
            createdBy: actor.userId,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Supplier facility was not created");
        await this.recordChange(transaction, actor, {
          after: { label: created.label, status: created.status },
          commandName: "CreateSupplierFacility",
          entityId: created.id,
          entityType: "SupplierLocation",
          eventType: "administration.supplier_facility_created",
          metadata: { supplierId },
        });
        const facilities = await transaction
          .select()
          .from(supplierLocations)
          .where(
            and(
              eq(supplierLocations.tenantId, actor.tenantId),
              eq(supplierLocations.supplierId, supplier.id),
            ),
          )
          .orderBy(supplierLocations.label);
        return {
          body: {
            facilities: facilities.map((facility) => ({
              addressSummary: facility.addressSummary,
              id: facility.id,
              label: facility.label,
              status: facility.status,
            })),
            id: supplier.id,
            name: supplier.name,
            status: supplier.status,
          },
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  private async rolesForUser(
    transaction: TenantTransaction,
    actor: Actor,
    userId: string,
  ): Promise<AdministrationRoleDto[]> {
    return (
      await transaction
        .select({
          code: roles.code,
          id: roles.id,
          name: roles.name,
          permissions: roles.permissions,
          status: roles.status,
        })
        .from(userRoles)
        .innerJoin(
          roles,
          and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)),
        )
        .where(and(eq(userRoles.tenantId, actor.tenantId), eq(userRoles.userId, userId)))
        .orderBy(roles.name)
    ).map(roleDto);
  }

  private async recordChange(
    transaction: TenantTransaction,
    actor: Actor,
    input: {
      after: unknown;
      before?: unknown;
      commandName: string;
      entityId: string;
      entityType: string;
      eventType: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const auditEventId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: actor.userId,
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      correlationId: this.context.correlationId(),
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: auditEventId,
      metadata: input.metadata ?? {},
      tenantId: actor.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.entityId,
      aggregateType: input.entityType,
      createdBy: actor.userId,
      eventType: input.eventType,
      payload: { auditEventId, ...(input.metadata ?? {}) },
      tenantId: actor.tenantId,
      updatedBy: actor.userId,
    });
  }
}

function roleDto(record: {
  code: string;
  id: string;
  name: string;
  permissions: string[];
  status: string;
}): AdministrationRoleDto {
  return {
    code: record.code,
    id: record.id,
    name: record.name,
    permissions: record.permissions,
    status: record.status,
  };
}

function userBaseDto(record: typeof users.$inferSelect) {
  return {
    displayName: record.displayName,
    email: record.email,
    id: record.id,
    identityLinked: record.externalSubject !== null,
    status: record.status,
  };
}

function companyPaymentAccountDto(
  record: typeof companyPaymentAccounts.$inferSelect,
): CompanyPaymentAccountDto {
  return {
    accountReference: record.accountReference,
    code: record.code,
    id: record.id,
    instructions: record.instructions,
    isDefault: record.isDefault,
    name: record.name,
    paymentMethod: record.paymentMethod as CompanyPaymentAccountDto["paymentMethod"],
    status: record.status,
  };
}

function checklistTemplateDto(
  template: typeof checklistTemplates.$inferSelect,
  items: (typeof checklistTemplateItems.$inferSelect)[],
): ChecklistTemplateDto {
  return {
    id: template.id,
    items: items.map((item) => ({
      id: item.id,
      instructions: item.instructions,
      label: item.label,
      requiresEvidence: item.requiresEvidence,
      responseType: item.responseType,
      sequence: item.sequence,
    })),
    name: template.name,
    publishedAt: template.publishedAt?.toISOString() ?? null,
    required: template.required,
    serviceType: template.serviceType,
    status: template.status,
    templateCode: template.templateCode,
    version: template.version,
  };
}

function auditEventDto(record: {
  actorDisplayName: string | null;
  commandName: string;
  entityId: string;
  entityType: string;
  eventType: string;
  id: string;
  occurredAt: Date;
}): AdministrationAuditEventDto {
  return { ...record, occurredAt: record.occurredAt.toISOString() };
}

function normalizeChecklist(input: CreateChecklistTemplateDto) {
  const sequences = input.items.map((item) => item.sequence);
  if (new Set(sequences).size !== sequences.length) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "CHECKLIST_SEQUENCE_DUPLICATE",
      "Checklist item sequence values must be unique",
    );
  }
  return {
    items: input.items
      .map((item) => ({
        instructions: optionalText(item.instructions),
        label: requireText(item.label, "checklist item label"),
        requiresEvidence: item.requiresEvidence ?? false,
        responseType: item.responseType,
        sequence: item.sequence,
      }))
      .toSorted((left, right) => left.sequence - right.sequence),
    name: requireText(input.name, "checklist name"),
    required: input.required ?? true,
    serviceType: input.serviceType ?? null,
    templateCode: input.templateCode.trim().toLowerCase(),
  };
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "ADMINISTRATION_VALUE_REQUIRED",
      `${titleCase(label)} is required`,
    );
  }
  return normalized;
}

function optionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function serviceLabel(value: string): string {
  return value === "dump_trailer_rental" ? "Dump trailer rental" : "Material delivery";
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}
