import type { AuthContext } from "@nailsoft/domain-types";

export type StaffBranch = AuthContext["branches"][number];
export type StaffBranchContext = {
  authorizedBranches: StaffBranch[];
  activeBranchId?: string;
};

let current: StaffBranchContext = { authorizedBranches: [] };

export function authorizedStaffBranches(context: AuthContext): StaffBranch[] {
  const allowed = new Set(context.authorization.branchIds);
  const support = context.supportAccess ? new Set(context.supportAccess.branchIds) : undefined;
  return context.branches.filter((branch) => allowed.has(branch.id) && (!support || support.has(branch.id)));
}

export function syncStaffBranchContext(context: AuthContext): StaffBranchContext {
  const branches = authorizedStaffBranches(context);
  const previous = current.activeBranchId;
  const activeBranchId = branches.length === 1
    ? branches[0]?.id
    : previous && branches.some((branch) => branch.id === previous) ? previous : undefined;
  current = { authorizedBranches: branches, ...(activeBranchId ? { activeBranchId } : {}) };
  return current;
}

export function getStaffBranchContext() {
  return current;
}

export function getActiveStaffBranchId() {
  return current.activeBranchId;
}

export function selectStaffBranch(branchId: string | undefined) {
  if (!branchId) {
    current = { authorizedBranches: current.authorizedBranches };
    return true;
  }
  if (!current.authorizedBranches.some((branch) => branch.id === branchId)) return false;
  current = { ...current, activeBranchId: branchId };
  return true;
}

export function resolveStaffOperationalBranch(context: AuthContext, entityBranchId?: string, selectedBranchId?: string) {
  const branches = authorizedStaffBranches(context);
  if (entityBranchId && branches.some((branch) => branch.id === entityBranchId)) return entityBranchId;
  if (selectedBranchId && branches.some((branch) => branch.id === selectedBranchId)) return selectedBranchId;
  return branches.length === 1 ? branches[0]?.id : undefined;
}

export function isAuthorizedStaffBranch(context: AuthContext, branchId: string | undefined) {
  return !!branchId && authorizedStaffBranches(context).some((branch) => branch.id === branchId);
}

export function clearStaffBranchContext() {
  current = { authorizedBranches: [] };
}
