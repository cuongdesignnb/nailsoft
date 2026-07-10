import type { ApiResponse } from '@nailsoft/domain-types';
export interface ClientOptions { baseUrl: string; getAccessToken?: () => string | undefined; getTenantId?: () => string | undefined }
export const createApiClient = (options: ClientOptions) => ({
  async request<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    const token = options.getAccessToken?.(); const tenant = options.getTenantId?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (tenant) headers.set('x-tenant-id', tenant);
    const response = await fetch(`${options.baseUrl}${path}`, { ...init, headers });
    return response.json() as Promise<ApiResponse<T>>;
  }
});
