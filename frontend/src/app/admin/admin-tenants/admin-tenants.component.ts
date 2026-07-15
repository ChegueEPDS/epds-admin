import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AdminService, AdminTenant } from '../../services/admin.service';
import { TenantFeatureKey } from '../../services/auth.service';
import { TenantDialogComponent } from './tenant-dialog.component';

@Component({
  selector: 'app-admin-tenants',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule
  ],
  templateUrl: './admin-tenants.component.html',
  styleUrl: './admin-tenants.component.scss'
})
export class AdminTenantsComponent implements OnInit {
  tenants = signal<AdminTenant[]>([]);
  loading = signal(false);
  displayedColumns = ['name', 'type', 'features', 'createdAt', 'actions'];
  featureLabels: { key: TenantFeatureKey; label: string }[] = [
    { key: 'mail', label: 'Mail' },
    { key: 'domainHealth', label: 'Domain Health' },
    { key: 'licenses', label: 'Licenses' },
    { key: 'effortTracking', label: 'Effort Tracking' },
    { key: 'webhookTester', label: 'Webhook Tester' }
  ];

  constructor(
    private admin: AdminService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loading.set(true);
    this.admin.listTenants().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Tenants could not be loaded.', 'Close', { duration: 4500 });
      }
    });
  }

  openAddTenant(): void {
    const ref = this.dialog.open(TenantDialogComponent, {
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
      data: {}
    });
    ref.afterClosed().subscribe((created: AdminTenant | undefined) => {
      if (!created) return;
      this.tenants.set([...this.tenants(), created].sort((a, b) => this.tenantLabel(a).localeCompare(this.tenantLabel(b))));
      this.snackBar.open('Tenant created.', 'Close', { duration: 3000 });
    });
  }

  openEditTenant(tenant: AdminTenant): void {
    const ref = this.dialog.open(TenantDialogComponent, {
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
      data: { tenant }
    });
    ref.afterClosed().subscribe((updated: AdminTenant | undefined) => {
      if (!updated) return;
      this.tenants.set(this.tenants()
        .map((item) => item.id === updated.id ? updated : item)
        .sort((a, b) => this.tenantLabel(a).localeCompare(this.tenantLabel(b))));
      this.snackBar.open('Tenant saved.', 'Close', { duration: 3000 });
    });
  }

  enabledFeatureText(tenant: AdminTenant): string {
    const enabled = this.featureLabels
      .filter((feature) => tenant.features?.[feature.key]?.enabled)
      .map((feature) => {
        const access = tenant.features[feature.key];
        const permissions = [
          access.edit ? 'edit' : null,
          access.delete ? 'delete' : null
        ].filter(Boolean).join('/');
        return permissions ? `${feature.label} (${permissions})` : feature.label;
      });
    return enabled.length ? enabled.join(', ') : '-';
  }

  tenantLabel(tenant: AdminTenant): string {
    return tenant.displayName || tenant.name;
  }
}
