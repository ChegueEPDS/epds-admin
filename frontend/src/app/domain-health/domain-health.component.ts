import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  DomainCheck,
  DomainHealthService,
  DomainMonitor,
  DomainPerformanceStatus,
  DomainMonitorStatus,
  DomainPayload
} from '../services/domain-health.service';

type RangeOption = '24h' | '7d' | '30d';
type StatusFilter = 'all' | 'issues' | 'warning' | 'healthy';

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
    MatSlideToggleModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data.domain ? 'Edit domain' : 'Add domain' }}</h2>
    <form (ngSubmit)="save()">
      <mat-dialog-content class="domain-dialog-content">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput name="name" [(ngModel)]="model.name" required>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Base URL</mat-label>
          <input matInput name="baseUrl" [(ngModel)]="model.baseUrl" placeholder="https://example.com" required>
        </mat-form-field>
        <mat-slide-toggle name="enabled" [(ngModel)]="model.enabled">Enabled</mat-slide-toggle>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button color="primary" type="submit">
          <mat-icon class="material-symbols-outlined">save</mat-icon>
          Save
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [`
    .domain-dialog-content {
      display: grid;
      min-width: min(520px, calc(100vw - 48px));
      gap: 12px;
      padding-top: 8px;
    }
    button mat-icon {
      margin-right: 6px;
    }
  `]
})
export class DomainDialogComponent {
  model: DomainPayload;

  constructor(
    private dialogRef: MatDialogRef<DomainDialogComponent, DomainPayload>,
    @Inject(MAT_DIALOG_DATA) public data: { domain?: DomainMonitor }
  ) {
    this.model = {
      name: data.domain?.name || '',
      baseUrl: data.domain?.baseUrl || '',
      enabled: data.domain?.enabled ?? true
    };
  }

  save(): void {
    if (!this.model.name.trim() || !this.model.baseUrl.trim()) return;
    this.dialogRef.close({
      name: this.model.name.trim(),
      baseUrl: this.model.baseUrl.trim(),
      enabled: this.model.enabled
    });
  }
}

@Component({
  selector: 'app-domain-health',
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
  templateUrl: './domain-health.component.html',
  styleUrl: './domain-health.component.scss'
})
export class DomainHealthComponent implements OnInit {
  domains: DomainMonitor[] = [];
  selectedDomain: DomainMonitor | null = null;
  checks: DomainCheck[] = [];
  searchTerm = '';
  statusFilter: StatusFilter = 'all';
  selectedRange: RangeOption = '24h';
  isLoading = false;
  isChecking = false;
  isLoadingChecks = false;

  constructor(
    private service: DomainHealthService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadDomains();
  }

  async loadDomains(): Promise<void> {
    this.isLoading = true;
    try {
      const response = await firstValueFrom(this.service.listDomains());
      this.domains = response.domains;
      if (this.selectedDomain) {
        this.selectedDomain = this.domains.find((domain) => domain.id === this.selectedDomain?.id) || null;
      }
    } catch (error: any) {
      this.snackBar.open(error?.error?.error || 'Failed to load domains.', 'Close', { duration: 4500 });
    } finally {
      this.isLoading = false;
    }
  }

  get filteredDomains(): DomainMonitor[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.domains.filter((domain) => {
      const matchesSearch = !term ||
        domain.name.toLowerCase().includes(term) ||
        domain.baseUrl.toLowerCase().includes(term);
      const matchesStatus =
        this.statusFilter === 'all' ||
        (this.statusFilter === 'issues' && domain.displayStatus === 'error') ||
        (this.statusFilter === 'warning' && domain.displayStatus === 'warning') ||
        (this.statusFilter === 'healthy' && domain.displayStatus === 'ok');
      return matchesSearch && matchesStatus;
    });
  }

  summary(status: DomainMonitorStatus): number {
    return this.domains.filter((domain) => domain.displayStatus === status).length;
  }

  async openDomainDialog(domain?: DomainMonitor): Promise<void> {
    const payload = await firstValueFrom(
      this.dialog.open(DomainDialogComponent, { data: { domain } }).afterClosed()
    );
    if (!payload) return;

    try {
      if (domain) {
        await firstValueFrom(this.service.updateDomain(domain.id, payload));
      } else {
        await firstValueFrom(this.service.createDomain(payload));
      }
      await this.loadDomains();
      this.snackBar.open('Domain saved.', 'Close', { duration: 2500 });
    } catch (error: any) {
      this.snackBar.open(error?.error?.error || 'Failed to save domain.', 'Close', { duration: 4500 });
    }
  }

  async deleteDomain(domain: DomainMonitor, event: Event): Promise<void> {
    event.stopPropagation();
    if (!window.confirm(`Delete ${domain.name}?`)) return;

    try {
      await firstValueFrom(this.service.deleteDomain(domain.id));
      if (this.selectedDomain?.id === domain.id) {
        this.selectedDomain = null;
        this.checks = [];
      }
      await this.loadDomains();
      this.snackBar.open('Domain deleted.', 'Close', { duration: 2500 });
    } catch (error: any) {
      this.snackBar.open(error?.error?.error || 'Failed to delete domain.', 'Close', { duration: 4500 });
    }
  }

  async selectDomain(domain: DomainMonitor): Promise<void> {
    this.selectedDomain = domain;
    await this.loadChecks();
  }

  async loadChecks(): Promise<void> {
    if (!this.selectedDomain) return;
    this.isLoadingChecks = true;
    try {
      const response = await firstValueFrom(this.service.getChecks(this.selectedDomain.id, this.selectedRange));
      this.selectedDomain = response.domain;
      this.checks = response.checks;
    } catch (error: any) {
      this.snackBar.open(error?.error?.error || 'Failed to load timeline.', 'Close', { duration: 4500 });
    } finally {
      this.isLoadingChecks = false;
    }
  }

  async checkNow(domain: DomainMonitor, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.isChecking = true;
    try {
      const response = await firstValueFrom(this.service.checkNow(domain.id));
      this.upsertDomain(response.domain);
      if (this.selectedDomain?.id === domain.id) {
        this.selectedDomain = response.domain;
        await this.loadChecks();
      }
      this.snackBar.open('Domain checked.', 'Close', { duration: 2500 });
    } catch (error: any) {
      this.snackBar.open(error?.error?.error || 'Domain check failed.', 'Close', { duration: 4500 });
    } finally {
      this.isChecking = false;
    }
  }

  upsertDomain(domain: DomainMonitor): void {
    const index = this.domains.findIndex((item) => item.id === domain.id);
    if (index >= 0) {
      this.domains = [
        ...this.domains.slice(0, index),
        domain,
        ...this.domains.slice(index + 1)
      ];
    }
  }

  statusIcon(status: DomainMonitorStatus): string {
    if (status === 'error') return 'error';
    if (status === 'warning') return 'warning';
    if (status === 'ok') return 'check_circle';
    return 'help';
  }

  statusLabel(status: DomainMonitorStatus): string {
    if (status === 'error') return 'Down';
    if (status === 'warning') return 'Recent issue';
    if (status === 'ok') return 'Healthy';
    return 'No data';
  }

  responseText(domain: DomainMonitor): string {
    return typeof domain.lastResponseMs === 'number' ? `${domain.lastResponseMs} ms` : '-';
  }

  uptimePercent(): string {
    const uptime = this.selectedDomain?.availability?.uptimePercent;
    return typeof uptime === 'number' ? `${uptime}%` : '-';
  }

  uptimeText(domain: DomainMonitor): string {
    const uptime = domain.availability?.uptimePercent;
    return typeof uptime === 'number' ? `${uptime}%` : '-';
  }

  msText(value?: number | null): string {
    return typeof value === 'number' ? `${value} ms` : '-';
  }

  performanceIcon(status?: DomainPerformanceStatus): string {
    if (status === 'very_slow') return 'priority_high';
    if (status === 'slow') return 'speed';
    if (status === 'ok') return 'bolt';
    return 'help';
  }

  performanceLabel(status?: DomainPerformanceStatus): string {
    if (status === 'very_slow') return 'Very slow';
    if (status === 'slow') return 'Slow';
    if (status === 'ok') return 'OK';
    return 'No data';
  }

  performanceStatus(domain: DomainMonitor): DomainPerformanceStatus {
    return domain.performance?.status || 'unknown';
  }

  issueText(domain: DomainMonitor): string {
    if (domain.displayStatus === 'error') return domain.lastError || 'Current issue';
    if (domain.displayStatus === 'warning') return `${domain.recentIssueCount} issue in 24h`;
    if (domain.displayStatus === 'ok') return 'No recent issues';
    return 'No check yet';
  }

  chartPoints(): Array<{ x: number; y: number; color: string; label: string; check: DomainCheck }> {
    if (!this.checks.length) return [];
    const values = this.checks.map((check) => check.ok ? Math.max(check.responseMs || 0, 1) : 10000);
    const max = Math.max(...values, 1000);
    const width = 720;
    const height = 220;
    const pad = 28;
    const span = Math.max(this.checks.length - 1, 1);

    return this.checks.map((check, index) => {
      const value = check.ok ? Math.max(check.responseMs || 0, 1) : max;
      const x = pad + (index / span) * (width - pad * 2);
      const y = height - pad - (value / max) * (height - pad * 2);
      const color = !check.ok ? '#b91c1c' : (check.responseMs || 0) > 5000 ? '#b91c1c' : (check.responseMs || 0) > 2500 ? '#b45309' : '#047857';
      const label = `${new Date(check.checkedAt).toLocaleString()} · ${check.ok ? `${check.responseMs} ms` : check.errorType || 'failed'}`;
      return { x, y, color, label, check };
    });
  }

  polylinePoints(): string {
    return this.chartPoints().map((point) => `${point.x},${point.y}`).join(' ');
  }

  trackByDomain(_: number, domain: DomainMonitor): string {
    return domain.id;
  }

  trackByCheck(_: number, check: DomainCheck): string {
    return check.id;
  }
}
