import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminService, AdminTenant, TenantType } from '../../services/admin.service';
import { TenantFeatureKey, TenantFeatures } from '../../services/auth.service';

type TenantDialogData = {
  tenant?: AdminTenant;
};

type TenantFeatureOption = {
  key: TenantFeatureKey;
  label: string;
  permissions?: boolean;
};

@Component({
  selector: 'app-tenant-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSnackBarModule
  ],
  templateUrl: './tenant-dialog.component.html',
  styleUrl: './tenant-dialog.component.scss'
})
export class TenantDialogComponent {
  saving = signal(false);
  name = '';
  displayName = '';
  type: TenantType = 'company';
  types: { value: TenantType; label: string }[] = [
    { value: 'company', label: 'Company' },
    { value: 'client', label: 'Client' }
  ];
  features: TenantFeatures = {
    mail: { enabled: false, edit: false, delete: false },
    domainHealth: { enabled: true, edit: false, delete: false },
    licenses: { enabled: false, edit: false, delete: false },
    effortTracking: { enabled: false, edit: false, delete: false },
    workBoard: { enabled: false, edit: false, delete: false },
    webhookTester: { enabled: false, edit: false, delete: false }
  };
  featureOptions: TenantFeatureOption[] = [
    { key: 'mail', label: 'Mail' },
    { key: 'domainHealth', label: 'Domain Health' },
    { key: 'licenses', label: 'Licenses' },
    { key: 'effortTracking', label: 'Effort Tracking' },
    { key: 'workBoard', label: 'Work Board' },
    { key: 'webhookTester', label: 'Webhook Tester', permissions: false }
  ];

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: TenantDialogData,
    private admin: AdminService,
    private dialogRef: MatDialogRef<TenantDialogComponent, AdminTenant>,
    private snackBar: MatSnackBar
  ) {
    if (data.tenant) {
      this.name = data.tenant.name || '';
      this.displayName = data.tenant.displayName || data.tenant.name || '';
      this.type = data.tenant.type || 'company';
      this.features = { ...this.features, ...(data.tenant.features || {}) };
      this.applyFeaturePolicy();
    }
  }

  get isEditMode(): boolean {
    return Boolean(this.data.tenant);
  }

  get title(): string {
    return this.isEditMode ? 'Edit tenant' : 'Add tenant';
  }

  get submitLabel(): string {
    return this.isEditMode ? 'Save' : 'Create';
  }

  onTypeChange(): void {
    if (this.type === 'client') {
      this.features.domainHealth.enabled = false;
      this.features.domainHealth.edit = false;
      this.features.domainHealth.delete = false;
      this.features.licenses.enabled = false;
      this.features.licenses.edit = false;
      this.features.licenses.delete = false;
    }
    this.applyFeaturePolicy();
  }

  onFeatureEnabledChange(feature: TenantFeatureOption): void {
    if (!this.features[feature.key].enabled || !this.hasPermissionControls(feature)) {
      this.features[feature.key].edit = false;
      this.features[feature.key].delete = false;
    }
    this.applyFeaturePolicy();
  }

  isFeatureDisabled(feature: TenantFeatureOption): boolean {
    return this.type === 'client' && feature.key !== 'licenses' && feature.key !== 'domainHealth';
  }

  hasPermissionControls(feature: TenantFeatureOption): boolean {
    return feature.permissions !== false;
  }

  isEditDisabled(feature: TenantFeatureOption): boolean {
    return this.isFeatureDisabled(feature) || !this.features[feature.key].enabled || !this.hasPermissionControls(feature);
  }

  isDeleteDisabled(feature: TenantFeatureOption): boolean {
    return this.isEditDisabled(feature) || (this.type === 'client' && feature.key === 'domainHealth');
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.applyFeaturePolicy();
    const payload = { name: this.name, displayName: this.displayName, type: this.type, features: this.features };
    const request = this.data.tenant
      ? this.admin.updateTenant(this.data.tenant.id, payload)
      : this.admin.createTenant(payload);

    request.subscribe({
      next: (tenant) => this.dialogRef.close(tenant),
      error: (error) => {
        this.saving.set(false);
        this.snackBar.open(error?.error?.error || 'Tenant could not be saved.', 'Close', { duration: 4500 });
      }
    });
  }

  private applyFeaturePolicy(): void {
    this.featureOptions.forEach((feature) => {
      const access = this.features[feature.key];
      if (this.isFeatureDisabled(feature)) {
        access.enabled = false;
        access.edit = false;
        access.delete = false;
        return;
      }
      if (!this.hasPermissionControls(feature)) {
        access.edit = false;
        access.delete = false;
        return;
      }
      if (!access.enabled) {
        access.edit = false;
        access.delete = false;
        return;
      }
      if (this.type === 'client' && feature.key === 'domainHealth') {
        access.delete = false;
      }
    });
  }
}
