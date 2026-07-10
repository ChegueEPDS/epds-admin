import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import type { TenantFeatures } from './auth.service';

export type AdminTenant = {
  id: string;
  name: string;
  displayName?: string;
  type: TenantType;
  features: TenantFeatures;
  ownerUserId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type TenantType = 'company' | 'client';

export type TenantPayload = {
  name: string;
  displayName?: string;
  type: TenantType;
  features: TenantFeatures;
};

export type AdminUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantDisplayName?: string | null;
  azureId?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AssignableRole = 'User' | 'Admin' | 'Finance';

export type CreateAdminUserPayload = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  role: AssignableRole;
};

export type UpdateAdminUserPayload = {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  role: AssignableRole;
};

export type IntegrationClient = {
  id: string;
  name: string;
  keyPrefix: string;
  status: 'active' | 'revoked';
  scopes: string[];
  webhookUrl: string;
  webhookEnabled: boolean;
  lastUsedAt: string | null;
  lastWebhookSuccessAt: string | null;
  revokedAt: string | null;
  deliveryCounts: { pending: number; delivered: number; dead: number };
  lastDeliveryError: string;
  lastDeliveryErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationPayload = {
  name: string;
  webhookUrl: string;
  webhookEnabled: boolean;
};

export type IntegrationCredentials = {
  apiKey?: string;
  webhookSecret?: string;
};

export type IntegrationMutationResult = {
  client: IntegrationClient;
  credentials?: IntegrationCredentials;
};

@Injectable({ providedIn: 'root' })
export class AdminService {
  private baseUrl = `${environment.apiUrl}/api/admin`;

  constructor(private http: HttpClient) {}

  listUsers(): Observable<AdminUser[]> {
    return this.http.get<{ users: AdminUser[] }>(`${this.baseUrl}/users`, { withCredentials: true })
      .pipe(map((res) => res.users || []));
  }

  createUser(payload: CreateAdminUserPayload): Observable<AdminUser> {
    return this.http.post<{ user: AdminUser }>(`${this.baseUrl}/users`, payload, { withCredentials: true })
      .pipe(map((res) => res.user));
  }

  updateUserRole(userId: string, role: AssignableRole): Observable<AdminUser> {
    return this.http.patch<{ user: AdminUser }>(
      `${this.baseUrl}/users/${encodeURIComponent(userId)}/role`,
      { role },
      { withCredentials: true }
    ).pipe(map((res) => res.user));
  }

  updateUser(userId: string, payload: UpdateAdminUserPayload): Observable<AdminUser> {
    return this.http.patch<{ user: AdminUser }>(
      `${this.baseUrl}/users/${encodeURIComponent(userId)}`,
      payload,
      { withCredentials: true }
    ).pipe(map((res) => res.user));
  }

  listTenants(): Observable<AdminTenant[]> {
    return this.http.get<{ tenants: AdminTenant[] }>(`${this.baseUrl}/tenants`, { withCredentials: true })
      .pipe(map((res) => res.tenants || []));
  }

  createTenant(payload: TenantPayload): Observable<AdminTenant> {
    return this.http.post<{ tenant: AdminTenant }>(`${this.baseUrl}/tenants`, payload, { withCredentials: true })
      .pipe(map((res) => res.tenant));
  }

  updateTenant(tenantId: string, payload: TenantPayload): Observable<AdminTenant> {
    return this.http.patch<{ tenant: AdminTenant }>(
      `${this.baseUrl}/tenants/${encodeURIComponent(tenantId)}`,
      payload,
      { withCredentials: true }
    ).pipe(map((res) => res.tenant));
  }

  listIntegrations(): Observable<IntegrationClient[]> {
    return this.http.get<{ clients: IntegrationClient[] }>(`${this.baseUrl}/integrations`, { withCredentials: true })
      .pipe(map((res) => res.clients || []));
  }

  createIntegration(payload: IntegrationPayload): Observable<IntegrationMutationResult> {
    return this.http.post<IntegrationMutationResult>(`${this.baseUrl}/integrations`, payload, { withCredentials: true });
  }

  updateIntegration(id: string, payload: IntegrationPayload): Observable<IntegrationMutationResult> {
    return this.http.patch<IntegrationMutationResult>(
      `${this.baseUrl}/integrations/${encodeURIComponent(id)}`,
      payload,
      { withCredentials: true }
    );
  }

  rotateIntegrationApiKey(id: string): Observable<IntegrationMutationResult> {
    return this.http.post<IntegrationMutationResult>(
      `${this.baseUrl}/integrations/${encodeURIComponent(id)}/rotate-api-key`, {}, { withCredentials: true }
    );
  }

  rotateIntegrationWebhookSecret(id: string): Observable<IntegrationMutationResult> {
    return this.http.post<IntegrationMutationResult>(
      `${this.baseUrl}/integrations/${encodeURIComponent(id)}/rotate-webhook-secret`, {}, { withCredentials: true }
    );
  }

  revokeIntegration(id: string): Observable<IntegrationMutationResult> {
    return this.http.post<IntegrationMutationResult>(
      `${this.baseUrl}/integrations/${encodeURIComponent(id)}/revoke`, {}, { withCredentials: true }
    );
  }

  retryIntegrationDeliveries(id: string): Observable<number> {
    return this.http.post<{ retried: number }>(
      `${this.baseUrl}/integrations/${encodeURIComponent(id)}/retry-deliveries`, {}, { withCredentials: true }
    ).pipe(map((res) => res.retried || 0));
  }
}
