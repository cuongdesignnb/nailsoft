import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "./auth.types.js";
import { PasswordService } from "./password.service.js";

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(160),
  password: z.string().min(10).max(128),
  locale: z.enum(["vi-VN", "en-US"]).default("vi-VN"),
  role: z.enum([
    "SALON_OWNER",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
    "CASHIER",
    "NAIL_TECHNICIAN",
    "ACCOUNTANT",
    "MARKETING_STAFF",
  ]),
  branchId: z.string().uuid().nullable(),
});

@Injectable()
export class UserService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}
  async list(auth: AccessClaims) {
    const owner = auth.roles.includes("SALON_OWNER");
    const result = await this.db.query(
      `SELECT u.id,u.email,u.display_name "displayName",u.locale,u.status,coalesce(json_agg(json_build_object('role',ur.role,'branchId',ur.branch_id)) FILTER(WHERE ur.role IS NOT NULL),'[]') roles FROM users u LEFT JOIN user_roles ur ON ur.tenant_id=u.tenant_id AND ur.user_id=u.id WHERE u.tenant_id=$1 AND ($2 OR ur.branch_id=ANY($3::uuid[]) OR ur.branch_id IS NULL) GROUP BY u.id ORDER BY u.display_name`,
      [auth.tenantId, owner, auth.branchIds],
    );
    return result.rows;
  }
  async create(auth: AccessClaims, input: unknown, requestId: string) {
    const body = createUserSchema.parse(input);
    if (body.role !== "SALON_OWNER" && !body.branchId)
      throw new ConflictException({
        code: "BRANCH_REQUIRED",
        message: "A branch is required for this role",
      });
    return this.db.transaction(async (client) => {
      if (body.branchId) {
        const branch = await client.query(
          "SELECT 1 FROM branches WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, body.branchId],
        );
        if (branch.rowCount !== 1)
          throw new ConflictException({
            code: "INVALID_BRANCH",
            message: "Branch does not belong to the tenant",
          });
      }
      const id = randomUUID();
      const passwordHash = await this.passwords.hash(body.password);
      const result = await client.query(
        'INSERT INTO users(id,tenant_id,email,display_name,password_hash,locale) VALUES($1,$2,lower($3),$4,$5,$6) RETURNING id,email,display_name "displayName",locale,status',
        [
          id,
          auth.tenantId,
          body.email,
          body.displayName,
          passwordHash,
          body.locale,
        ],
      );
      await client.query(
        "INSERT INTO user_roles(tenant_id,user_id,branch_id,role) VALUES($1,$2,$3,$4)",
        [auth.tenantId, id, body.branchId, body.role],
      );
      await client.query(
        "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,'user.create','user',$4,$5,$6)",
        [
          auth.tenantId,
          body.branchId,
          auth.userId,
          id,
          JSON.stringify({
            email: body.email,
            displayName: body.displayName,
            role: body.role,
          }),
          requestId,
        ],
      );
      return {
        ...result.rows[0],
        roles: [{ role: body.role, branchId: body.branchId }],
      };
    });
  }
}
