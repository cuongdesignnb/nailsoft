import type { AuthContext } from "@nailsoft/domain-types";

export type AuthorizedBranch = AuthContext["branches"][number];
export type OwnerBranchContext = {
  authorizedBranches: AuthorizedBranch[];
  activeBranchId?: string;
};

let current: OwnerBranchContext = { authorizedBranches: [] };

export function authorizedBranches(context: AuthContext): AuthorizedBranch[] {
  const authorized = new Set(context.authorization.branchIds);
  const support = context.supportAccess ? new Set(context.supportAccess.branchIds) : null;
  return context.branches.filter((branch) => authorized.has(branch.id) && (!support || support.has(branch.id)));
}

export function syncBranchContext(context: AuthContext): OwnerBranchContext {
  const branches = authorizedBranches(context);
  const previous = current.activeBranchId;
  const activeBranchId = branches.length === 1
    ? branches[0]?.id
    : previous && branches.some((branch) => branch.id === previous) ? previous : undefined;
  current = { authorizedBranches: branches, ...(activeBranchId ? { activeBranchId } : {}) };
  return current;
}

export function getOwnerBranchContext(): OwnerBranchContext {
  return current;
}

export function getActiveBranchId(): string | undefined {
  return current.activeBranchId;
}

export function selectActiveBranch(branchId: string | undefined): boolean {
  if (!branchId) {
    current = { authorizedBranches: current.authorizedBranches };
    return true;
  }
  if (!current.authorizedBranches.some((branch) => branch.id === branchId)) return false;
  current = { ...current, activeBranchId: branchId };
  return true;
}

export function clearActiveBranchContext() {
  current = { authorizedBranches: [] };
}
