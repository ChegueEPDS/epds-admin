import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { environment } from '../../environments/environment';

export type MfaChallenge = { account: string; challenge: string; setup: boolean; passkey: boolean };
export type MfaSetup = { qr: string; key: string };
export type MfaStatus = {
  available: boolean;
  enabled?: boolean;
  required?: boolean;
  recommendationDismissed?: boolean;
  recoveryRemaining?: number;
  passkeyAvailable?: boolean;
  passkeys?: Array<{ id: string; name: string; createdAt: string }>;
};

@Injectable({ providedIn: 'root' })
export class MfaApi {
  private http = inject(HttpClient);
  private base = `${environment.apiBaseUrl}/auth/mfa`;

  status(): Promise<MfaStatus> {
    return firstValueFrom(this.http.get<MfaStatus>(this.base));
  }

  post<T>(path: string, body: object = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${this.base}/${path}`, body, {
      headers: { 'X-No-Redirect-On-401': '1' }
    }));
  }

  async authenticate(flow: MfaChallenge) {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const optionsJSON = await this.post<PublicKeyCredentialRequestOptionsJSON>('login/passkey', flow);
    return startAuthentication({ optionsJSON });
  }

  async register(password: string) {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const optionsJSON = await this.post<PublicKeyCredentialCreationOptionsJSON>('passkey', { password });
    return startRegistration({ optionsJSON });
  }
}

export function mfaError(error: unknown, fallback: string): string {
  const failure = error as { error?: { error?: string }; name?: string; code?: string };
  if (['NotAllowedError', 'AbortError'].includes(failure?.name || '') || failure?.code === 'ERROR_CEREMONY_ABORTED') {
    return 'The passkey prompt was closed or timed out. Try again or choose another method.';
  }
  return failure?.error?.error || fallback;
}
