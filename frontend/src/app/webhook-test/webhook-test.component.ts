import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { environment } from '../../environments/environment';

interface WebhookReceipt {
  _id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  rawBody: string;
  parsedBody: unknown;
  byteLength: number;
  receivedAt: string;
}

type SignatureState = 'valid' | 'invalid' | 'missing' | 'unchecked';

@Component({
  selector: 'app-webhook-test',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    RouterLink
  ],
  templateUrl: './webhook-test.component.html',
  styleUrl: './webhook-test.component.scss'
})
export class WebhookTestComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storageKey = 'epds-webhook-test-inbox-token';

  readonly receipts = signal<WebhookReceipt[]>([]);
  readonly selected = signal<WebhookReceipt | null>(null);
  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly message = signal('');
  readonly signatureStates = signal<Record<string, SignatureState>>({});

  token = '';
  webhookSecret = '';
  testBody = JSON.stringify({
    id: crypto.randomUUID(),
    type: 'license.ordered',
    occurredAt: new Date().toISOString(),
    data: {
      previousStatus: 'active',
      status: 'ordered',
      license: {
        id: 'test-license-id',
        customerName: 'Test customer',
        status: 'ordered',
        objectLimit: 6000,
        expiresAt: '2027-12-31T00:00:00.000Z',
        mobileApp: true,
        mobileAppVersion: '1.4.0',
        licenseFile: null,
        mobileAppFile: {
          fileName: 'epds-mobile.apk',
          contentType: 'application/vnd.android.package-archive',
          size: 52428800,
          uploadedAt: new Date().toISOString()
        }
      }
    }
  }, null, 2);

  get receiverUrl(): string {
    return `${environment.apiUrl.replace(/\/$/, '')}/api/webhook-test/inboxes/${this.token}`;
  }

  ngOnInit(): void {
    this.token = localStorage.getItem(this.storageKey) || this.createToken();
    localStorage.setItem(this.storageKey, this.token);
    timer(0, 2000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load(false));
  }

  createInbox(): void {
    this.token = this.createToken();
    localStorage.setItem(this.storageKey, this.token);
    this.receipts.set([]);
    this.selected.set(null);
    this.signatureStates.set({});
    this.message.set('New empty inbox created.');
    this.load(false);
  }

  load(showSpinner = true): void {
    if (!this.token || this.loading()) return;
    if (showSpinner) this.loading.set(true);
    this.http.get<{ data: WebhookReceipt[] }>(`${this.receiverUrl}/requests`)
      .subscribe({
        next: ({ data }) => {
          this.loading.set(false);
          this.receipts.set(data);
          const current = this.selected();
          if (current) this.selected.set(data.find((item) => item._id === current._id) || data[0] || null);
          else if (data.length) this.selected.set(data[0]);
          void this.verifyAll(data);
        },
        error: () => {
          this.loading.set(false);
          if (showSpinner) this.message.set('The inbox could not be loaded. Is the backend running?');
        }
      });
  }

  sendTest(): void {
    let payload: unknown;
    try {
      payload = JSON.parse(this.testBody);
    } catch {
      this.message.set('The test body is not valid JSON.');
      return;
    }
    this.sending.set(true);
    this.message.set('');
    this.http.post(this.receiverUrl, payload, { observe: 'response' }).subscribe({
      next: () => {
        this.sending.set(false);
        this.message.set('Test request received.');
        this.load(false);
      },
      error: (error) => {
        this.sending.set(false);
        this.message.set(`Send failed (HTTP ${error.status || 'network error'}).`);
      }
    });
  }

  clear(): void {
    this.http.delete<{ deletedCount: number }>(`${this.receiverUrl}/requests`).subscribe({
      next: ({ deletedCount }) => {
        this.receipts.set([]);
        this.selected.set(null);
        this.signatureStates.set({});
        this.message.set(`${deletedCount} request(s) deleted.`);
      },
      error: () => this.message.set('The inbox could not be cleared.')
    });
  }

  choose(receipt: WebhookReceipt): void {
    this.selected.set(receipt);
  }

  async copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    this.message.set('Copied to clipboard.');
  }

  prettyBody(receipt: WebhookReceipt): string {
    return receipt.parsedBody == null ? receipt.rawBody : JSON.stringify(receipt.parsedBody, null, 2);
  }

  prettyHeaders(receipt: WebhookReceipt): string {
    return JSON.stringify(receipt.headers, null, 2);
  }

  signatureState(receipt: WebhookReceipt): SignatureState {
    return this.signatureStates()[receipt._id] || 'unchecked';
  }

  signatureLabel(receipt: WebhookReceipt): string {
    const labels: Record<SignatureState, string> = {
      valid: 'Valid EPDS signature',
      invalid: 'Invalid EPDS signature',
      missing: 'No EPDS signature',
      unchecked: this.webhookSecret.trim() ? 'Checking signature' : 'Add secret to verify'
    };
    return labels[this.signatureState(receipt)];
  }

  onSecretChange(): void {
    void this.verifyAll(this.receipts());
  }

  private createToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private async verifyAll(receipts: WebhookReceipt[]): Promise<void> {
    const states: Record<string, SignatureState> = {};
    await Promise.all(receipts.map(async (receipt) => {
      states[receipt._id] = await this.verifySignature(receipt);
    }));
    this.signatureStates.set(states);
  }

  private async verifySignature(receipt: WebhookReceipt): Promise<SignatureState> {
    const timestamp = receipt.headers['x-epds-timestamp'];
    const signature = receipt.headers['x-epds-signature'];
    if (!timestamp || !signature) return 'missing';
    if (!this.webhookSecret.trim()) return 'unchecked';
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.webhookSecret.trim()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const digest = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${receipt.rawBody}`)
    );
    const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return signature === `v1=${expected}` ? 'valid' : 'invalid';
  }
}
