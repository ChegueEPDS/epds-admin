import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import {
  AdminService,
  IntegrationClient,
  IntegrationCredentials,
  IntegrationMutationResult,
  IntegrationPayload
} from '../../services/admin.service';

@Component({
  selector: 'app-integration-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.client ? 'Edit integration' : 'New integration' }}</h2>
    <mat-dialog-content>
      <p class="dialog-note">API access always includes all licenses, event polling and license-file upload.</p>
      <mat-form-field appearance="outline">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="name" maxlength="120" required>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Webhook URL</mat-label>
        <input matInput [(ngModel)]="webhookUrl" type="url" placeholder="https://service.example.com/epds-webhook">
        <mat-hint>Public HTTPS URL without a custom port.</mat-hint>
      </mat-form-field>
      <mat-checkbox [(ngModel)]="webhookEnabled">Enable webhook delivery</mat-checkbox>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="!canSave()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { display: grid; min-width: min(480px, 75vw); gap: 14px; padding-top: 8px; }
    mat-form-field { width: 100%; }
    .dialog-note { margin: 0 0 4px; color: rgba(19, 19, 19, .65); }
  `]
})
export class IntegrationDialogComponent {
  name: string;
  webhookUrl: string;
  webhookEnabled: boolean;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { client?: IntegrationClient },
    private ref: MatDialogRef<IntegrationDialogComponent>
  ) {
    this.name = data.client?.name || '';
    this.webhookUrl = data.client?.webhookUrl || '';
    this.webhookEnabled = data.client?.webhookEnabled || false;
  }

  canSave(): boolean {
    return Boolean(this.name.trim() && (!this.webhookEnabled || this.webhookUrl.trim()));
  }

  save(): void {
    if (!this.canSave()) return;
    this.ref.close({
      name: this.name.trim(),
      webhookUrl: this.webhookUrl.trim(),
      webhookEnabled: this.webhookEnabled
    } satisfies IntegrationPayload);
  }
}

@Component({
  selector: 'app-integration-credentials-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatIconModule, MatTooltipModule],
  template: `
    <h2 mat-dialog-title>Store these credentials now</h2>
    <mat-dialog-content>
      <p>Secrets are shown once and cannot be retrieved later.</p>
      <div class="secret" *ngIf="data.apiKey">
        <span>API key</span><code>{{ data.apiKey }}</code>
        <button mat-icon-button type="button" matTooltip="Copy API key" (click)="copy(data.apiKey!)">
          <mat-icon class="material-symbols-outlined">content_copy</mat-icon>
        </button>
      </div>
      <div class="secret" *ngIf="data.webhookSecret">
        <span>Webhook signing secret</span><code>{{ data.webhookSecret }}</code>
        <button mat-icon-button type="button" matTooltip="Copy webhook secret" (click)="copy(data.webhookSecret!)">
          <mat-icon class="material-symbols-outlined">content_copy</mat-icon>
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-flat-button color="primary" mat-dialog-close>Stored securely</button></mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: min(620px, 80vw); }
    .secret { display: grid; grid-template-columns: 1fr auto; gap: 7px 10px; align-items: center; margin: 18px 0; }
    .secret span { grid-column: 1 / -1; font-weight: 700; }
    code { overflow-wrap: anywhere; padding: 12px; border-radius: 6px; background: #f3f4f6; color: #7c2d12; }
  `]
})
export class IntegrationCredentialsDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: IntegrationCredentials) {}

  copy(value: string): void {
    navigator.clipboard.writeText(value).catch(() => {});
  }
}

@Component({
  selector: 'app-admin-integrations',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
    RouterLink
  ],
  templateUrl: './admin-integrations.component.html',
  styleUrl: './admin-integrations.component.scss'
})
export class AdminIntegrationsComponent implements OnInit {
  clients = signal<IntegrationClient[]>([]);
  loading = signal(false);
  busyId = signal<string | null>(null);
  displayedColumns = ['name', 'apiKey', 'webhook', 'deliveries', 'activity', 'status', 'actions'];

  constructor(private admin: AdminService, private dialog: MatDialog, private snackBar: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.admin.listIntegrations().subscribe({
      next: (clients) => { this.clients.set(clients); this.loading.set(false); },
      error: () => { this.loading.set(false); this.notify('Integrations could not be loaded.'); }
    });
  }

  openCreate(): void {
    this.dialog.open(IntegrationDialogComponent, { width: '560px', maxWidth: 'calc(100vw - 32px)', data: {} })
      .afterClosed().subscribe((payload?: IntegrationPayload) => {
        if (!payload) return;
        this.admin.createIntegration(payload).subscribe({
          next: (result) => { this.clients.set([result.client, ...this.clients()]); this.showCredentials(result); },
          error: (error) => this.notify(error?.error?.error || 'Integration could not be created.')
        });
      });
  }

  openEdit(client: IntegrationClient): void {
    this.dialog.open(IntegrationDialogComponent, { width: '560px', maxWidth: 'calc(100vw - 32px)', data: { client } })
      .afterClosed().subscribe((payload?: IntegrationPayload) => {
        if (!payload) return;
        this.admin.updateIntegration(client.id, payload).subscribe({
          next: (result) => { this.replace(result.client); this.notify('Integration saved.'); },
          error: (error) => this.notify(error?.error?.error || 'Integration could not be saved.')
        });
      });
  }

  rotateApiKey(client: IntegrationClient): void {
    if (!confirm(`Rotate the API key for ${client.name}? The current key will stop working immediately.`)) return;
    this.run(client, this.admin.rotateIntegrationApiKey(client.id), (result) => this.showCredentials(result));
  }

  rotateWebhookSecret(client: IntegrationClient): void {
    if (!confirm(`Rotate the webhook secret for ${client.name}?`)) return;
    this.run(client, this.admin.rotateIntegrationWebhookSecret(client.id), (result) => this.showCredentials(result));
  }

  revoke(client: IntegrationClient): void {
    if (!confirm(`Revoke ${client.name}? API and webhook access will stop immediately.`)) return;
    this.run(client, this.admin.revokeIntegration(client.id), () => this.notify('Integration revoked.'));
  }

  retry(client: IntegrationClient): void {
    this.busyId.set(client.id);
    this.admin.retryIntegrationDeliveries(client.id).subscribe({
      next: (count) => { this.busyId.set(null); this.notify(`${count} webhook deliveries queued for retry.`); this.load(); },
      error: (error) => { this.busyId.set(null); this.notify(error?.error?.error || 'Deliveries could not be retried.'); }
    });
  }

  private run(client: IntegrationClient, request: ReturnType<AdminService['rotateIntegrationApiKey']>, success: (result: IntegrationMutationResult) => void): void {
    this.busyId.set(client.id);
    request.subscribe({
      next: (result) => { this.busyId.set(null); this.replace(result.client); success(result); },
      error: (error) => { this.busyId.set(null); this.notify(error?.error?.error || 'Integration operation failed.'); }
    });
  }

  private replace(client: IntegrationClient): void {
    this.clients.set(this.clients().map((item) => item.id === client.id ? { ...item, ...client } : item));
  }

  private showCredentials(result: IntegrationMutationResult): void {
    if (!result.credentials) return;
    this.dialog.open(IntegrationCredentialsDialogComponent, {
      width: '700px', maxWidth: 'calc(100vw - 32px)', disableClose: true, data: result.credentials
    });
  }

  private notify(message: string): void { this.snackBar.open(message, 'Close', { duration: 4500 }); }
}
