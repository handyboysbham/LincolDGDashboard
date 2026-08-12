import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { type Database, roles, userRoles, users, withTenantTransaction } from "@ldg/database";
import { and, eq } from "drizzle-orm";

import type { RequestActor } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";

@Injectable()
export class AuthenticatedActorService {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async load(tenantId: string, externalSubject: string): Promise<RequestActor> {
    try {
      const actor = await withTenantTransaction(this.database, tenantId, async (transaction) => {
        const [user] = await transaction
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.externalSubject, externalSubject)))
          .limit(1);
        if (user?.status !== "active") return undefined;

        const assignedRoles = await transaction
          .select({ permissions: roles.permissions })
          .from(userRoles)
          .innerJoin(
            roles,
            and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)),
          )
          .where(
            and(
              eq(userRoles.tenantId, tenantId),
              eq(userRoles.userId, user.id),
              eq(roles.status, "active"),
            ),
          );
        return {
          permissions: new Set(assignedRoles.flatMap((role) => role.permissions)),
          tenantId,
          userId: user.id,
        };
      });
      if (!actor) throw new Error("The authenticated user is unavailable");
      return actor;
    } catch {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTHENTICATION_INVALID",
        "The access token is invalid or expired",
      );
    }
  }
}
