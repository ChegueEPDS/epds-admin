import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, TemplateRef } from '@angular/core';
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
import { AdminService } from '../services/admin.service';
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
  maxY?: number;
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
  monthlyReports: { month: string; archived: boolean }[] = [];
  selectedReportMonth = '';
  isDownloadingMonthly = false;
  monthlyReportsError = '';
  checksError = '';
  checksUpdatedAt: Date | null = null;
  private chartMaximum = 10000;
  private chartStart = 0;
  private chartEnd = 0;
  private plottedPoints: ChartPoint[] = [];
  showDetails = false;
  activeChartPoint: ChartPoint | null = null;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private lastSeenMonitorCompletion = '';
  private checksRequestId = 0;
  readonly chart = {
    width: 720,
    height: 500,
    left: 52,
    right: 18,
    top: 22,
    bottom: 450
  };

  constructor(
    private service: DomainHealthService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private admin: AdminService,
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
    this.checksUpdatedAt = null;
    this.checksError = "";
      this.overview = null;
      this.activeChartPoint = null;
    }
  }

  async openDomainDialog(domain?: DomainMonitor): Promise<void> {
    const tenants = this.auth.isSuperAdmin() ? await firstValueFrom(this.admin.listTenants()) : [];
    const payload = await firstValueFrom(
      this.dialog.open(DomainDialogComponent, {
        width: '860px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100dvh - 32px)',
        autoFocus: false,
        data: { domain, tenants, canEditOwner: this.auth.isSuperAdmin() }
      }).afterClosed()
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
    this.checks = [];
    this.overview = null;
    this.activeChartPoint = null;
    this.showDetails = false;
    void this.loadMonthlyReports(domain.tenantId || '');
    await this.loadChecks();
  }

  async loadMonthlyReports(tenantId: string): Promise<void> {
    this.monthlyReports = [];
    this.selectedReportMonth = '';
    this.monthlyReportsError = '';
    if (!tenantId) return;
    try {
      const response = await firstValueFrom(this.service.getMonthlyReports(tenantId));
      if (this.selectedDomain?.tenantId !== tenantId) return;
      this.monthlyReports = response.months;
      this.selectedReportMonth = response.months[0]?.month || '';
    } catch {
      if (this.selectedDomain?.tenantId === tenantId) this.monthlyReportsError = 'Could not load monthly reports.';
    }
  }

  async downloadMonthlyReport(): Promise<void> {
    const tenant = this.selectedDomain?.tenantId;
    if (!tenant || !this.selectedReportMonth || this.isDownloadingMonthly) return;
    this.isDownloadingMonthly = true;
    const month = this.selectedReportMonth;
    try {
      const blob = await firstValueFrom(this.service.getMonthlyPdf(tenant, month));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `service-report-${month}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const item = this.monthlyReports.find(report => report.month === month);
      if (item) item.archived = true;
    } catch (error: any) {
      let message = 'Could not download monthly report. Please retry.';
      if (error.error instanceof Blob) {
        try { message = JSON.parse(await error.error.text()).error || message; } catch { /* Keep readable fallback. */ }
      }
      this.snackBar.open(message, 'Close', { duration: 6000 });
    } finally { this.isDownloadingMonthly = false; }
  }

  openChartDialog(template: TemplateRef<unknown>): void {
    this.activeChartPoint = null;
    this.dialog.open(template, {
      width: '1200px', maxWidth: '96vw', maxHeight: '94dvh',
      ariaLabel: 'Enlarged response time chart'
    }).afterClosed().subscribe(() => this.activeChartPoint = null);
  }

  async loadChecks(options: { silent?: boolean } = {}): Promise<void> {
    if (!this.selectedDomain) return;
    const requestId = ++this.checksRequestId;
    const domainId = this.selectedDomain.id;
    const range = this.selectedRange;
    this.checksError = '';
    if (!options.silent) {
      this.isLoadingChecks = true;
      this.activeChartPoint = null;
    }
    try {
      const response = await firstValueFrom(this.service.getChecks(domainId, range));
      if (requestId !== this.checksRequestId || this.selectedDomain?.id !== domainId || this.selectedRange !== range) return;
      this.selectedDomain = response.domain;
      this.checks = response.checks;
      this.overview = response.overview;
      this.checksUpdatedAt = new Date();
      this.chartEnd = this.checksUpdatedAt.getTime();
      this.chartStart = this.chartEnd - ({ '24h': 1, '7d': 7, '30d': 30 }[range] * 86400000);
      this.rebuildChartPoints();
      this.activeChartPoint = null;
    } catch (error: any) {
      if (requestId === this.checksRequestId && !options.silent) {
        this.checksError = error?.error?.error || 'Failed to load timeline.';
      }
    } finally {
      if (requestId === this.checksRequestId && !options.silent) this.isLoadingChecks = false;
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
    return domain.owner || domain.tenantDisplayName || domain.tenantName || '-';
  }

  chartMaxMs(): number {
    return this.chartMaximum;
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

  chartTimeTicks(): { x: number; label: string }[] {
    return Array.from({ length: 5 }, (_, index) => {
      const time = new Date(this.chartStart + (this.chartEnd - this.chartStart) * index / 4);
      return {
        x: this.chart.left + (this.chart.width - this.chart.left - this.chart.right) * index / 4,
        label: this.selectedRange === '24h'
          ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : time.toLocaleDateString([], { month: 'short', day: 'numeric' })
      };
    });
  }

  chartPoints(): ChartPoint[] {
    return this.plottedPoints;
  }

  private rebuildChartPoints(): void {
    this.chartMaximum = Math.ceil(this.checks.reduce((maximum, check) => Math.max(maximum, check.ok ? check.responseMs || 0 : 10000), 10000) / 1000) * 1000;
    const groups = new Map<number, DomainCheck[]>();
    const sorted = [...this.checks].sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
    sorted.forEach((check, index) => {
      const key = this.selectedRange === '24h' ? index : Math.floor(Date.parse(check.checkedAt) / 3600000);
      const group = groups.get(key);
      if (group) group.push(check);
      else groups.set(key, [check]);
    });
    this.plottedPoints = Array.from(groups.values()).map((samples) => {
      const failures = samples.filter(check => this.checkStatus(check) === 'error');
      const warnings = samples.filter(check => this.checkStatus(check) === 'warning');
      const check = failures[0] || warnings[0] || samples[0];
      const values = samples.filter(item => item.ok && typeof item.responseMs === 'number').map(item => item.responseMs!);
      const average = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
      const maximum = values.length ? Math.max(...values) : 0;
      const status = this.checkStatus(check);
      const grouped = this.selectedRange !== '24h';
      const time = Date.parse(samples[0].checkedAt);
      const x = this.chart.left + Math.max(0, Math.min(1, (time - this.chartStart) / (this.chartEnd - this.chartStart))) * (this.chart.width - this.chart.left - this.chart.right);
      const y = this.chartY(failures.length ? this.chartMaxMs() : average);
      const color = status === 'error' ? '#b91c1c' : status === 'warning' ? '#b45309' : '#047857';
      const timeText = new Date(time).toLocaleString();
      const valueText = grouped ? `Avg ${average} ms · Max ${maximum} ms` : (check.ok ? `${check.responseMs || 0} ms` : 'Failed');
      const detailText = grouped ? `${samples.length} checks · ${failures.length} down · ${warnings.length} warnings` : this.checkDetailText(check);
      const statusText = status === 'error' ? 'Down' : status === 'warning' ? 'Warning' : 'OK';
      return { x, y, color, label: `${timeText} · ${valueText} · ${detailText}`, timeText, valueText, detailText, statusText, check,
        maxY: grouped && values.length ? this.chartY(maximum) : undefined };
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
