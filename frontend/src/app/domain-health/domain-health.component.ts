import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
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
  DomainIncident,
  DomainMonitor,
  DomainMonitorRuntime,
  DomainStatusHistoryBucket,
  DomainStatusOverview,
  DomainPerformanceStatus,
  DomainMonitorStatus
} from '../services/domain-health.service';
import { AuthService } from '../services/auth.service';
import { DomainDialogComponent } from './domain-dialog/domain-dialog.component';
import { DomainDeepScanDialogComponent } from './deep-scan-dialog/deep-scan-dialog.component';

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
    MatSlideToggleModule,
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
  overview: DomainStatusOverview | null = null;
  searchTerm = '';
  showDisabledDomains = false;
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
        if (!this.selectedDomain) this.overview = null;
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
        if (!this.selectedDomain) this.overview = null;
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
    return this.visibleDomains.filter((domain) => {
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

  get visibleDomains(): DomainMonitor[] {
    return this.showDisabledDomains ? this.domains : this.domains.filter((domain) => domain.enabled);
  }

  summary(status: DomainMonitorStatus): number {
    return this.visibleDomains.filter((domain) => domain.displayStatus === status).length;
  }

  setShowDisabledDomains(showDisabled: boolean): void {
    this.showDisabledDomains = showDisabled;
    if (!showDisabled && this.selectedDomain && !this.selectedDomain.enabled) {
      this.selectedDomain = null;
      this.checks = [];
      this.overview = null;
      this.activeChartPoint = null;
    }
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
        this.overview = null;
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
      this.overview = response.overview;
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
    if (status === 'warning') return 'Warning';
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
    if (domain.displayStatus === 'warning') return domain.lastWarning || `${domain.recentWarningCount || 0} warning in 24h`;
    if (domain.displayStatus === 'ok') return 'No recent issues';
    return 'No check yet';
  }

  checkTargetText(domain: DomainMonitor): string {
    return domain.healthConfig?.checkPath || '/';
  }

  statusRangeText(domain: DomainMonitor): string {
    const config = domain.healthConfig;
    if (!config) return '200-399';
    return `${config.expectedStatusMin}-${config.expectedStatusMax}`;
  }

  tlsText(domain: DomainMonitor): string {
    if (typeof domain.lastTlsDaysRemaining !== 'number') return '-';
    if (domain.lastTlsDaysRemaining <= 0) return 'Expired';
    return `${domain.lastTlsDaysRemaining}d`;
  }

  finalUrlText(domain: DomainMonitor): string {
    return domain.lastFinalUrl || '-';
  }

  redirectText(domain: DomainMonitor): string {
    return typeof domain.lastRedirectCount === 'number' ? String(domain.lastRedirectCount) : '-';
  }

  contentText(domain: DomainMonitor): string {
    const type = domain.lastContentType || '-';
    if (typeof domain.lastContentLength !== 'number') return type;
    return `${type} · ${Math.round(domain.lastContentLength / 1024)} KB`;
  }

  ownerSlug(owner?: string | null): string {
    return String(owner || 'all')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'all';
  }

  publicStatusRoute(domain: DomainMonitor): string {
    return `/status/${this.ownerSlug(domain.owner)}`;
  }

  windowSummary(label: '24h' | '7d' | '30d') {
    return this.overview?.windows.find((window) => window.label === label) || null;
  }

  avgResponseText(label: '24h' | '7d' | '30d'): string {
    return this.msText(this.windowSummary(label)?.avgResponseMs ?? null);
  }

  incidentCountText(label: '24h' | '7d' | '30d'): string {
    const count = this.windowSummary(label)?.incidentCount;
    return typeof count === 'number' ? String(count) : '-';
  }

  incidentDurationText(incident: DomainIncident): string {
    const minutes = Math.round(incident.durationMs / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  historyTitle(bucket: DomainStatusHistoryBucket): string {
    const label = bucket.status === 'ok' ? 'OK' : bucket.status === 'warning' ? 'Warning' : bucket.status === 'error' ? 'Down' : 'No data';
    const detail = typeof bucket.responseMs === 'number' ? `${bucket.responseMs} ms` : 'No sample';
    return `${label} · ${new Date(bucket.bucketStart).toLocaleString()} · ${detail}`;
  }

  tlsStatusClass(): string {
    const status = this.overview?.tls.status || 'unknown';
    return `tls-${status}`;
  }

  checkStatus(check: DomainCheck): 'ok' | 'warning' | 'error' {
    return check.status || (check.ok ? 'ok' : 'error');
  }

  checkIcon(check: DomainCheck): string {
    const status = this.checkStatus(check);
    if (status === 'error') return 'error';
    if (status === 'warning') return 'warning';
    return 'check_circle';
  }

  checkDetailText(check: DomainCheck): string {
    const prefix = check.ok ? `${check.responseMs || 0} ms · HTTP ${check.statusCode || '-'}` : (check.errorMessage || check.errorType || 'Request failed');
    const warning = check.warningMessage || check.warningType;
    return warning ? `${prefix} · ${warning}` : prefix;
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
      const status = this.checkStatus(check);
      const color = status === 'error' ? '#b91c1c' : status === 'warning' ? '#b45309' : '#047857';
      const timeText = new Date(check.checkedAt).toLocaleString();
      const valueText = check.ok ? `${check.responseMs || 0} ms` : 'Failed';
      const detailText = this.checkDetailText(check);
      const statusText = status === 'error' ? 'Down' : status === 'warning' ? 'Warning' : 'OK';
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
