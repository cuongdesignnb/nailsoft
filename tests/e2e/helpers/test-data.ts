export function unique(prefix: string) { return `${prefix}-E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
export function names(value: string) { return { "vi-VN": value, "en-US": value }; }
export const branchA = "20000000-0000-4000-8000-000000000001";
export const branchB = "20000000-0000-4000-8000-000000000002";
export const technicianAStaff = "47000000-0000-4000-8000-000000000005";
export const technicianBStaff = "47000000-0000-4000-8000-000000000014";
export const seedSkill = "41000000-0000-4000-8000-000000000001";
export const seedResourceType = "45000000-0000-4000-8000-000000000001";
