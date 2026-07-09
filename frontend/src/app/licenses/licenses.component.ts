import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  LicenseClientTenant,
  LicenseCustomer,
  LicenseService,
  LicenseStatus
} from '../services/license.service';
import { LicenseDialogComponent, LicenseDialogResult } from './license-dialog/license-dialog.component';
import { AuthService } from '../services/auth.service';

type StatusFilter = 'all' | LicenseStatus | 'expired';

@Component({
  selector: 'app-licenses',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule
  ],
  templateUrl: './licenses.component.html',
  styleUrl: './licenses.component.scss'
})
export class LicensesComponent implements OnInit {
  licenses: LicenseCustomer[] = [];
  clientTenants: LicenseClientTenant[] = [];
  searchTerm = '';
  statusFilter: StatusFilter = 'all';
  isLoading = false;

  constructor(
    private licenseService: LicenseService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadLicenses();
  }

  get filteredLicenses(): LicenseCustomer[] {
    const search = this.searchTerm.trim().toLowerCase();
    return this.licenses.filter((license) => {
      const matchesSearch = !search || license.customerName.toLowerCase().includes(search);
      const matchesStatus = this.statusFilter === 'all'
        || license.status === this.statusFilter
        || (this.statusFilter === 'expired' && this.isExpired(license));
      return matchesSearch && matchesStatus;
    });
  }

  async loadLicenses(): Promise<void> {
    this.isLoading = true;
    try {
      const response = await firstValueFrom(this.licenseService.listLicenses());
      this.licenses = response.licenses;
      this.clientTenants = response.clientTenants || [];
    } catch (err) {
      this.showError('Could not load licenses');
    } finally {
      this.isLoading = false;
    }
  }

  async openLicenseDialog(license?: LicenseCustomer): Promise<void> {
    const ref = this.dialog.open(LicenseDialogComponent, {
      width: '1280px',
      maxWidth: 'calc(100vw - 24px)',
      data: {
        license,
        clientTenants: this.clientTenants,
        canEdit: this.auth.canEditFeature('licenses'),
        canDelete: this.auth.canDeleteFeature('licenses')
      }
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;

    try {
      if (result.action === 'delete') {
        if (!license) return;
        await this.deleteLicense(license);
        return;
      }

      if (license) {
        const response = await firstValueFrom(this.licenseService.updateLicense(license.id, result.payload));
        this.licenses = this.licenses.map((item) => item.id === license.id ? response.license : item);
        this.snackBar.open('License updated', 'Close', { duration: 2500 });
      } else {
        const response = await firstValueFrom(this.licenseService.createLicense(result.payload));
        this.licenses = [...this.licenses, response.license].sort((a, b) => a.customerName.localeCompare(b.customerName));
        this.snackBar.open('License created', 'Close', { duration: 2500 });
      }
    } catch (err: any) {
      this.showError(err?.error?.error || 'Could not save license');
    }
  }

  async deleteLicense(license: LicenseCustomer): Promise<void> {
    if (!confirm(`Delete license for ${license.customerName}?`)) return;
    try {
      await firstValueFrom(this.licenseService.deleteLicense(license.id));
      this.licenses = this.licenses.filter((item) => item.id !== license.id);
      this.snackBar.open('License deleted', 'Close', { duration: 2500 });
    } catch {
      this.showError('Could not delete license');
    }
  }

  trackByLicense(index: number, license: LicenseCustomer): string {
    return license.id;
  }

  summary(status: StatusFilter): number {
    if (status === 'all') return this.licenses.length;
    if (status === 'expired') return this.licenses.filter((license) => this.isExpired(license)).length;
    return this.licenses.filter((license) => license.status === status).length;
  }

  isExpired(license: LicenseCustomer): boolean {
    const expiresAt = new Date(license.expiresAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return expiresAt < today;
  }

  expiresSoon(license: LicenseCustomer): boolean {
    if (this.isExpired(license)) return false;
    const expiresAt = new Date(license.expiresAt).getTime();
    const soon = Date.now() + 30 * 24 * 60 * 60 * 1000;
    return expiresAt <= soon;
  }

  statusIcon(license: LicenseCustomer): string {
    if (license.status === 'inactive') return 'pause_circle';
    if (this.isExpired(license)) return 'event_busy';
    if (this.expiresSoon(license)) return 'warning';
    return 'check_circle';
  }

  statusLabel(license: LicenseCustomer): string {
    if (license.status === 'inactive') return 'Inactive';
    if (this.isExpired(license)) return 'Expired';
    if (this.expiresSoon(license)) return 'Expires soon';
    return 'Active';
  }

  rowStatusClass(license: LicenseCustomer): string {
    if (license.status === 'inactive') return 'status-inactive';
    if (this.isExpired(license)) return 'status-expired';
    if (this.expiresSoon(license)) return 'status-warning';
    return 'status-active';
  }

  objectLimitText(license: LicenseCustomer): string {
    if (license.objectLimitOption === 'unlimited') return 'Unlimited';
    const value = license.objectLimitOption === 'custom' ? license.customObjectLimit : Number(license.objectLimitOption);
    return this.formatObjectCount(value);
  }

  private formatObjectCount(value: number | string | null | undefined): string {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';
    return String(Math.trunc(numericValue)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3500 });
  }
}
