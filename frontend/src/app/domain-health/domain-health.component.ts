import { CommonModule } from '@angular/common';
import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
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
  DomainDeepScanResult,
  DomainHealthService,
  DomainMonitor,
  DomainMonitorRuntime,
  DomainOwner,
  DomainPerformanceStatus,
  DomainMonitorStatus,
  DomainPayload
} from '../services/domain-health.service';
import { AuthService } from '../services/auth.service';

type RangeOption = '24h' | '7d' | '30d';
type StatusFilter = 'all' | 'issues' | 'warning' | 'healthy';
type ChartPoint = {
  x: number;
  y: number;
  color: string;
  label: string;
  timeText: string;
  valueText: string;
  detailText: string;
  statusText: string;
  check: DomainCheck;
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
        <mat-form-field appearance="outline">
          <mat-label>Owner</mat-label>
          <mat-select name="owner" [(ngModel)]="model.owner" required>
            <mat-option *ngFor="let owner of owners" [value]="owner">{{ owner }}</mat-option>
          </mat-select>
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
  owners: DomainOwner[] = ['Stahl', 'Robex', 'Veproil', 'ExNB/Exva', 'Ind-Ex', 'EPDS'];
  model: DomainPayload;

  constructor(
    private dialogRef: MatDialogRef<DomainDialogComponent, DomainPayload>,
    @Inject(MAT_DIALOG_DATA) public data: { domain?: DomainMonitor }
  ) {
    this.model = {
      name: data.domain?.name || '',
      baseUrl: data.domain?.baseUrl || '',
      owner: data.domain?.owner || 'EPDS',
      enabled: data.domain?.enabled ?? true
    };
  }

  save(): void {
    if (!this.model.name.trim() || !this.model.baseUrl.trim() || !this.model.owner) return;
    this.dialogRef.close({
      name: this.model.name.trim(),
      baseUrl: this.model.baseUrl.trim(),
      owner: this.model.owner,
      enabled: this.model.enabled
    });
  }
}

@Component({
  selector: 'app-domain-deep-scan-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>Deep scan</h2>
    <mat-dialog-content class="deep-scan-dialog">
      <div class="deep-scan-head">
        <div>
          <strong>{{ data.domain.name }}</strong>
          <span>{{ data.domain.baseUrl }}</span>
        </div>
        <mat-progress-spinner *ngIf="isLoading" diameter="28" mode="indeterminate"></mat-progress-spinner>
      </div>

      <div *ngIf="isLoading" class="deep-scan-loading">
        <mat-icon class="material-symbols-outlined">speed</mat-icon>
        <span>Running mobile and desktop PageSpeed scan...</span>
      </div>

      <div *ngIf="!isLoading && error" class="deep-scan-error">
        <mat-icon class="material-symbols-outlined">error</mat-icon>
        <span>{{ error }}</span>
      </div>

      <div *ngIf="!isLoading && result" class="deep-scan-results">
        <section *ngFor="let scan of result.scans" class="scan-card">
          <div class="scan-card-head">
            <h3>{{ scan.strategy | titlecase }}</h3>
            <span *ngIf="scan.ok">{{ scan.fetchedAt | date:'short' }}</span>
            <span *ngIf="!scan.ok" class="scan-failed">Failed</span>
          </div>

          <div *ngIf="!scan.ok" class="scan-error">{{ scan.error || 'Scan failed.' }}</div>

          <ng-container *ngIf="scan.ok">
            <div class="score-grid">
              <div [class]="scoreClass(scan.scores?.performance)">
                <span>Performance</span>
                <strong>{{ scoreText(scan.scores?.performance) }}</strong>
              </div>
              <div [class]="scoreClass(scan.scores?.accessibility)">
                <span>Accessibility</span>
                <strong>{{ scoreText(scan.scores?.accessibility) }}</strong>
              </div>
              <div [class]="scoreClass(scan.scores?.bestPractices)">
                <span>Best practices</span>
                <strong>{{ scoreText(scan.scores?.bestPractices) }}</strong>
              </div>
              <div [class]="scoreClass(scan.scores?.seo)">
                <span>SEO</span>
                <strong>{{ scoreText(scan.scores?.seo) }}</strong>
              </div>
            </div>

            <div class="metric-list">
              <div>
                <span>FCP</span>
                <strong>{{ scan.metrics?.firstContentfulPaint?.displayValue || '-' }}</strong>
              </div>
              <div>
                <span>LCP</span>
                <strong>{{ scan.metrics?.largestContentfulPaint?.displayValue || '-' }}</strong>
              </div>
              <div>
                <span>CLS</span>
                <strong>{{ scan.metrics?.cumulativeLayoutShift?.displayValue || '-' }}</strong>
              </div>
              <div>
                <span>TBT</span>
                <strong>{{ scan.metrics?.totalBlockingTime?.displayValue || '-' }}</strong>
              </div>
              <div>
                <span>Speed index</span>
                <strong>{{ scan.metrics?.speedIndex?.displayValue || '-' }}</strong>
              </div>
            </div>

            <div class="opportunity-list">
              <h4>Top opportunities</h4>
              <div *ngIf="!scan.opportunities?.length" class="muted-row">No major opportunities returned.</div>
              <div *ngFor="let item of scan.opportunities" class="opportunity-row">
                <span>{{ item.title }}</span>
                <strong>{{ item.displayValue || savingsText(item.savingsMs) }}</strong>
              </div>
            </div>
          </ng-container>
        </section>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
    }
    .deep-scan-dialog {
      display: grid;
      width: 100%;
      max-height: calc(92vh - 108px);
      gap: 14px;
      padding-top: 4px;
    }
    .deep-scan-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .deep-scan-head strong,
    .deep-scan-head span {
      display: block;
    }
    .deep-scan-head span,
    .muted-row,
    .scan-card-head span {
      color: #6b7280;
      font-size: 12px;
    }
    .deep-scan-loading,
    .deep-scan-error {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 180px;
      color: #6b7280;
    }
    .deep-scan-error,
    .scan-error,
    .scan-failed {
      color: #b91c1c;
    }
    .deep-scan-results {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .scan-card {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--brand-border);
      border-radius: 8px;
      background: #fff;
    }
    .scan-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .scan-card-head h3,
    .opportunity-list h4 {
      margin: 0;
    }
    .score-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .score-grid div,
    .metric-list div {
      padding: 8px;
      border: 1px solid var(--brand-border);
      border-radius: 8px;
      background: #f8fafc;
    }
    .score-grid span,
    .metric-list span {
      display: block;
      margin-bottom: 4px;
      color: #6b7280;
      font-size: 11px;
    }
    .score-grid strong,
    .metric-list strong {
      font-size: 16px;
    }
    .score-ok strong {
      color: #047857;
    }
    .score-warning strong {
      color: #b45309;
    }
    .score-error strong {
      color: #b91c1c;
    }
    .metric-list {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
    }
    .opportunity-list {
      display: grid;
      gap: 8px;
    }
    .opportunity-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding-top: 8px;
      border-top: 1px solid var(--brand-border);
      font-size: 12px;
    }
    .opportunity-row span {
      min-width: 0;
    }
    .opportunity-row strong {
      white-space: nowrap;
    }
    @media (max-width: 900px) {
      .deep-scan-results,
      .score-grid,
      .metric-list {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class DomainDeepScanDialogComponent implements OnInit {
  isLoading = true;
  error = '';
  result: DomainDeepScanResult | null = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { domain: DomainMonitor },
    private service: DomainHealthService
  ) {}

  ngOnInit(): void {
    void this.run();
  }

  async run(): Promise<void> {
    this.isLoading = true;
    this.error = '';
    try {
      this.result = await firstValueFrom(this.service.deepScan(this.data.domain.id));
    } catch (error: any) {
      this.error = error?.error?.error || 'Deep scan failed.';
    } finally {
      this.isLoading = false;
    }
  }

  scoreText(value?: number | null): string {
    return typeof value === 'number' ? String(value) : '-';
  }

  scoreClass(value?: number | null): string {
    if (typeof value !== 'number') return 'score-unknown';
    if (value >= 90) return 'score-ok';
    if (value >= 50) return 'score-warning';
    return 'score-error';
  }

  savingsText(value?: number): string {
    return typeof value === 'number' ? `${value} ms` : '-';
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
export class DomainHealthComponent implements OnInit, OnDestroy {
  domains: DomainMonitor[] = [];
  monitor: DomainMonitorRuntime | null = null;
  selectedDomain: DomainMonitor | null = null;
  checks: DomainCheck[] = [];
  searchTerm = '';
  statusFilter: StatusFilter = 'all';
  selectedRange: RangeOption = '24h';
  isLoading = false;
  isChecking = false;
  isLoadingChecks = false;
  activeChartPoint: ChartPoint | null = null;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private lastSeenMonitorCompletion = '';
  readonly chart = {
    width: 720,
    height: 500,
    left: 52,
    right: 18,
    top: 22,
    bottom: 475
  };

  constructor(
    private service: DomainHealthService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadDomains();
    this.refreshTimer = setInterval(() => {
      void this.refreshAfterMonitorCompletion();
    }, 120000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async loadDomains(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) this.isLoading = true;
    try {
      const response = await firstValueFrom(this.service.listDomains());
      this.domains = response.domains;
      this.monitor = response.monitor || null;
      if (response.monitor?.lastRunCompletedAt) {
        this.lastSeenMonitorCompletion = response.monitor.lastRunCompletedAt;
      }
      if (this.selectedDomain) {
        this.selectedDomain = this.domains.find((domain) => domain.id === this.selectedDomain?.id) || null;
      }
    } catch (error: any) {
      if (!options.silent) {
        this.snackBar.open(error?.error?.error || 'Failed to load domains.', 'Close', { duration: 4500 });
      }
    } finally {
      if (!options.silent) this.isLoading = false;
    }
  }

  async refreshAfterMonitorCompletion(): Promise<void> {
    if (this.isLoading || this.isChecking || this.isLoadingChecks) return;
    try {
      const response = await firstValueFrom(this.service.listDomains());
      const completedAt = response.monitor?.lastRunCompletedAt || '';
      const hasNewCompletedRun = Boolean(completedAt && completedAt !== this.lastSeenMonitorCompletion);
      this.domains = response.domains;
      this.monitor = response.monitor || null;
      if (completedAt) this.lastSeenMonitorCompletion = completedAt;
      if (this.selectedDomain) {
        this.selectedDomain = this.domains.find((domain) => domain.id === this.selectedDomain?.id) || null;
      }
      if (hasNewCompletedRun && this.selectedDomain) {
        await this.loadChecks({ silent: true });
      }
    } catch {
      // Keep background refresh quiet; manual Refresh still reports errors.
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

  async loadChecks(options: { silent?: boolean } = {}): Promise<void> {
    if (!this.selectedDomain) return;
    if (!options.silent) this.isLoadingChecks = true;
    try {
      const response = await firstValueFrom(this.service.getChecks(this.selectedDomain.id, this.selectedRange));
      this.selectedDomain = response.domain;
      this.checks = response.checks;
      this.activeChartPoint = null;
    } catch (error: any) {
      if (!options.silent) {
        this.snackBar.open(error?.error?.error || 'Failed to load timeline.', 'Close', { duration: 4500 });
      }
    } finally {
      if (!options.silent) this.isLoadingChecks = false;
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

  openDeepScan(domain: DomainMonitor): void {
    this.dialog.open(DomainDeepScanDialogComponent, {
      data: { domain },
      autoFocus: false,
      width: '96vw',
      maxWidth: '1200px',
      height: '92vh',
      maxHeight: '92vh'
    });
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

  ownerText(domain: DomainMonitor): string {
    return domain.owner || 'EPDS';
  }

  chartMaxMs(): number {
    const values = this.checks.map((check) => check.ok ? Math.max(check.responseMs || 0, 1) : 10000);
    const max = Math.max(...values, 10000);
    return Math.ceil(max / 1000) * 1000;
  }

  chartY(value: number): number {
    const plotHeight = this.chart.bottom - this.chart.top;
    const capped = Math.min(Math.max(value, 0), this.chartMaxMs());
    return this.chart.bottom - (capped / this.chartMaxMs()) * plotHeight;
  }

  chartZoneY(fromMs: number, toMs: number): { y: number; height: number } {
    const yTop = this.chartY(toMs);
    const yBottom = this.chartY(fromMs);
    return { y: yTop, height: Math.max(yBottom - yTop, 0) };
  }

  chartTicks(): number[] {
    return Array.from(new Set([0, 2500, 5000, this.chartMaxMs()])).sort((a, b) => a - b);
  }

  chartTickLabel(value: number): string {
    if (value === 0) return '0';
    if (value === 2500) return '2.5s';
    if (value === 5000) return '5s';
    return `${Math.round(value / 1000)}s`;
  }

  chartPoints(): ChartPoint[] {
    if (!this.checks.length) return [];
    const plotWidth = this.chart.width - this.chart.left - this.chart.right;
    const span = Math.max(this.checks.length - 1, 1);

    return this.checks.map((check, index) => {
      const value = check.ok ? Math.max(check.responseMs || 0, 1) : this.chartMaxMs();
      const x = this.chart.left + (index / span) * plotWidth;
      const y = this.chartY(value);
      const color = !check.ok ? '#b91c1c' : (check.responseMs || 0) > 5000 ? '#b91c1c' : (check.responseMs || 0) > 2500 ? '#b45309' : '#047857';
      const timeText = new Date(check.checkedAt).toLocaleString();
      const valueText = check.ok ? `${check.responseMs || 0} ms` : 'Failed';
      const detailText = check.ok ? `HTTP ${check.statusCode || '-'}` : (check.errorMessage || check.errorType || 'Request failed');
      const statusText = !check.ok ? 'Down' : (check.responseMs || 0) > 5000 ? 'Very slow' : (check.responseMs || 0) > 2500 ? 'Slow' : 'OK';
      const label = `${timeText} · ${valueText} · ${detailText}`;
      return { x, y, color, label, timeText, valueText, detailText, statusText, check };
    });
  }

  polylinePoints(): string {
    return this.chartPoints().map((point) => `${point.x},${point.y}`).join(' ');
  }

  setActiveChartPoint(point: ChartPoint | null): void {
    this.activeChartPoint = point;
  }

  tooltipX(point: ChartPoint): number {
    return Math.min(Math.max(point.x - 92, 8), this.chart.width - 198);
  }

  tooltipY(point: ChartPoint): number {
    return point.y < 86 ? point.y + 14 : point.y - 78;
  }

  trackByDomain(_: number, domain: DomainMonitor): string {
    return domain.id;
  }

  trackByCheck(_: number, check: DomainCheck): string {
    return check.id;
  }
}
