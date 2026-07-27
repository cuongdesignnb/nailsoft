import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

@Injectable()
export class RegisterDeviceAuthorizationService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async assertRegisterAccess(input: {
    auth: AccessClaims;
    registerId: string;
    branchId: string;
    client?: PoolClient;
  }) {
    const session = (
      await this.query<{
        id: string;
        device_id: string;
      }>(
        input.client,
        `SELECT id,device_id
           FROM device_sessions
          WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND membership_id=$4
            AND revoked_at IS NULL AND expires_at>now()`,
        [
          input.auth.sessionId,
          input.auth.tenantId,
          input.auth.userId,
          input.auth.membershipId,
        ],
      )
    ).rows[0];
    if (!session)
      throw new ForbiddenException({
        code: "POS_REGISTER_DEVICE_SESSION_INVALID",
        message: "The authenticated device session is no longer valid",
      });

    const register = (
      await this.query<{
        id: string;
        device_binding_required: boolean;
      }>(
        input.client,
        `SELECT id,device_binding_required
           FROM pos_registers
          WHERE tenant_id=$1 AND id=$2 AND branch_id=$3 AND status='ACTIVE'`,
        [input.auth.tenantId, input.registerId, input.branchId],
      )
    ).rows[0];
    if (!register)
      throw new NotFoundException({
        code: "CASH_REGISTER_NOT_FOUND",
        message: "Active register not found",
      });

    if (register.device_binding_required) {
      const binding = await this.query(
        input.client,
        `SELECT 1
           FROM pos_register_device_bindings
          WHERE tenant_id=$1 AND register_id=$2 AND device_id=$3
            AND status='ACTIVE' AND revoked_at IS NULL`,
        [input.auth.tenantId, input.registerId, session.device_id],
      );
      if (!binding.rowCount)
        throw new ForbiddenException({
          code: "POS_REGISTER_DEVICE_NOT_BOUND",
          message: "The authenticated device is not bound to this register",
        });
    }

    return {
      deviceSessionId: session.id,
      deviceId: session.device_id,
      registerId: register.id,
    };
  }

  private query<T extends QueryResultRow = QueryResultRow>(
    client: PoolClient | undefined,
    text: string,
    values: unknown[],
  ) {
    return client
      ? client.query<T>(text, values)
      : this.db.query<T>(text, values);
  }
}
