import { login, close, type Session } from "../helpers/api-client";

export const accounts = {
  owner: "owner@example.test",
  managerA: "staff2@example.test",
  managerB: "manager-b@example.test",
  receptionist: "staff3@example.test",
  technicianA: "staff5@example.test",
  technicianB: "technician-b@example.test",
  platform: "platform-e2e@example.test",
} as const;
export async function authenticated(role: keyof typeof accounts): Promise<Session> { return login(accounts[role]); }
export { close };
