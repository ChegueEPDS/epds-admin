import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AdminTenant } from '../../services/admin.service';
import { DomainHealthConfig, DomainMonitor, DomainOwner, DomainPayload } from '../../services/domain-health.service';

type DomainDialogData = {
  domain?: DomainMonitor;
  tenants?: AdminTenant[];
  canEditOwner?: boolean;
};

@Component({
  selector: 'app-domain-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule
  ],
  templateUrl: './domain-dialog.component.html',
  styleUrl: './domain-dialog.component.scss'
})
export class DomainDialogComponent {
  owners: DomainOwner[] = ['ExNB', 'EXVA'];
  model: DomainPayload;
  readonly defaultHealthConfig: DomainHealthConfig = {
    checkPath: '',
    expectedStatusMin: 200,
    expectedStatusMax: 399,
    timeoutMs: 10000,
    warningResponseMs: 2500,
    errorResponseMs: 10000,
    followRedirects: true,
    tlsWarningDays: 30
  };

  constructor(
    private dialogRef: MatDialogRef<DomainDialogComponent, DomainPayload>,
    @Inject(MAT_DIALOG_DATA) public data: DomainDialogData
  ) {
    const existingOwner = data.domain?.owner as DomainOwner | undefined;
    this.model = {
      name: data.domain?.name || '',
      baseUrl: data.domain?.baseUrl || '',
      owner: existingOwner && this.owners.includes(existingOwner) ? existingOwner : 'ExNB',
      tenantId: data.domain?.tenantId || data.tenants?.[0]?.id || null,
      enabled: data.domain?.enabled ?? true,
      healthConfig: {
        ...this.defaultHealthConfig,
        ...(data.domain?.healthConfig || {})
      }
    };
  }

  get canEditOwner(): boolean {
    return Boolean(this.data.canEditOwner);
  }

  get selectedTenant(): AdminTenant | null {
    return (this.data.tenants || []).find((tenant) => tenant.id === this.model.tenantId) || null;
  }

  get needsOwnerBadge(): boolean {
    const tenant = this.selectedTenant;
    return Boolean(this.canEditOwner && tenant?.name === 'exnb-exva');
  }

  tenantLabel(tenant: AdminTenant): string {
    return tenant.displayName || tenant.name;
  }

  save(): void {
    if (!this.model.name.trim() || !this.model.baseUrl.trim()) return;
    if (this.canEditOwner && !this.model.tenantId) return;
    if (this.needsOwnerBadge && !this.model.owner) return;
    const payload: DomainPayload = {
      name: this.model.name.trim(),
      baseUrl: this.model.baseUrl.trim(),
      enabled: this.model.enabled,
      healthConfig: {
        checkPath: this.model.healthConfig.checkPath.trim(),
        expectedStatusMin: Number(this.model.healthConfig.expectedStatusMin),
        expectedStatusMax: Number(this.model.healthConfig.expectedStatusMax),
        timeoutMs: Number(this.model.healthConfig.timeoutMs),
        warningResponseMs: Number(this.model.healthConfig.warningResponseMs),
        errorResponseMs: Number(this.model.healthConfig.errorResponseMs),
        followRedirects: this.model.healthConfig.followRedirects,
        tlsWarningDays: Number(this.model.healthConfig.tlsWarningDays)
      }
    };
    if (this.canEditOwner) {
      payload.tenantId = this.model.tenantId;
      if (this.needsOwnerBadge) payload.owner = this.model.owner;
    }
    this.dialogRef.close(payload);
  }
}
