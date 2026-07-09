import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export type DomainRecordResult = {
  status: 'ok' | 'warning' | 'error';
  values: unknown[];
  selector?: string;
};

export type DomainHealthResult = {
  domain: string;
  checkedAt: string;
  summary: 'ok' | 'warning' | 'error';
  records: {
    mx: DomainRecordResult;
    spf: DomainRecordResult;
    dmarc: DomainRecordResult;
    dkim: DomainRecordResult;
  };
};

export type DomainMonitorStatus = 'ok' | 'warning' | 'error' | 'unknown';
export type DomainPerformanceStatus = 'ok' | 'slow' | 'very_slow' | 'unknown';
export type DomainOwner = 'Stahl' | 'Robex' | 'Veproil' | 'ExNB' | 'EXVA' | 'IndEx' | 'EPDS';

export type DomainMonitor = {
  id: string;
  name: string;
  baseUrl: string;
  owner: string;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantDisplayName?: string | null;
  enabled: boolean;
  lastCheckedAt?: string;
  lastStatus: DomainMonitorStatus;
  displayStatus: DomainMonitorStatus;
  lastResponseMs?: number;
  lastStatusCode?: number;
  lastError?: string;
  lastErrorType?: string;
  lastWarning?: string;
  lastWarningType?: string;
  lastFinalUrl?: string;
  lastRedirectCount?: number;
  lastContentType?: string;
  lastContentLength?: number;
  lastTlsValidTo?: string;
  lastTlsDaysRemaining?: number;
  healthConfig: DomainHealthConfig;
  currentIssueSince?: string;
  lastFailureAt?: string;
  lastRecoveryAt?: string;
  recentIssueCount: number;
  recentWarningCount: number;
  availability?: {
    status: DomainMonitorStatus;
    uptimePercent: number | null;
    totalChecks: number;
    recentIssueCount: number;
    recentWarningCount?: number;
  };
  performance?: {
    status: DomainPerformanceStatus;
    lastResponseMs?: number;
    medianResponseMs: number | null;
    p95ResponseMs: number | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type DomainCheck = {
  id: string;
  checkedAt: string;
  ok: boolean;
  status?: 'ok' | 'warning' | 'error';
  statusCode?: number;
  responseMs?: number;
  finalUrl?: string;
  redirectCount?: number;
  contentType?: string;
  contentLength?: number;
  tlsValidTo?: string;
  tlsDaysRemaining?: number;
  errorType?: string;
  errorMessage?: string;
  warningType?: string;
  warningMessage?: string;
};

export type DomainWindowSummary = {
  label: '24h' | '7d' | '30d';
  totalChecks: number;
  uptimePercent: number | null;
  avgResponseMs: number | null;
  medianResponseMs: number | null;
  p95ResponseMs: number | null;
  incidentCount: number;
};

export type DomainIncident = {
  severity: 'warning' | 'error';
  reasonCode: string;
  reasonText: string;
  startedAt: string;
  endedAt?: string | null;
  durationMs: number;
  isOpen: boolean;
};

export type DomainStatusHistoryBucket = {
  status: 'ok' | 'warning' | 'error' | 'unknown';
  bucketStart: string;
  checkedAt?: string | null;
  responseMs?: number | null;
};

export type DomainTlsSummary = {
  status: 'ok' | 'warning' | 'error' | 'unknown';
  validTo?: string | null;
  daysRemaining?: number | null;
  warningDays: number;
};

export type DomainStatusOverview = {
  windows: DomainWindowSummary[];
  incidents: DomainIncident[];
  currentIncident?: DomainIncident | null;
  history24h: DomainStatusHistoryBucket[];
  lastSuccessfulCheck?: DomainCheck | null;
  lastFailedCheck?: DomainCheck | null;
  lastWarningCheck?: DomainCheck | null;
  lastRecoveryAt?: string | null;
  tls: DomainTlsSummary;
};

export type DomainMonitorRuntime = {
  isRunning: boolean;
  intervalMs: number;
  lastRunStartedAt?: string | null;
  lastRunCompletedAt?: string | null;
  lastRunDomainCount: number;
};

export type PageSpeedMetric = {
  id: string;
  title?: string;
  displayValue?: string | null;
  numericValue?: number | null;
  score?: number | null;
};

export type DomainDeepScanResult = {
  id?: string;
  checkedAt: string;
  domain: DomainMonitor;
  domainId?: string;
  source?: 'manual' | 'scheduled';
  scans: Array<{
    ok: boolean;
    strategy: 'mobile' | 'desktop';
    requestedUrl?: string | null;
    finalUrl?: string | null;
    fetchedAt?: string;
    lighthouseVersion?: string | null;
    userAgent?: string | null;
    scores?: {
      performance: number | null;
      accessibility: number | null;
      bestPractices: number | null;
      seo: number | null;
    };
    metrics?: {
      firstContentfulPaint: PageSpeedMetric | null;
      largestContentfulPaint: PageSpeedMetric | null;
      cumulativeLayoutShift: PageSpeedMetric | null;
      totalBlockingTime: PageSpeedMetric | null;
      speedIndex: PageSpeedMetric | null;
    };
    opportunities?: Array<{
      id?: string;
      title?: string;
      displayValue?: string | null;
      savingsMs?: number;
    }>;
    warnings?: unknown[];
    runtimeError?: unknown;
    error?: string;
  }>;
};

export type DomainPageSpeedHistoryItem = {
  id: string;
  checkedAt: string;
  source: 'manual' | 'scheduled';
  mobilePerformance: number | null;
  desktopPerformance: number | null;
  mobileLcp: number | null;
  desktopLcp: number | null;
  mobileCls: number | null;
  desktopCls: number | null;
};

export type DomainPageSpeedOverview = {
  domain: DomainMonitor;
  latest: DomainDeepScanResult | null;
  history: DomainPageSpeedHistoryItem[];
  summary: {
    count: number;
    mobilePerformanceAvg: number | null;
    desktopPerformanceAvg: number | null;
    mobileLcpAvg: number | null;
    desktopLcpAvg: number | null;
  };
};

export type PublicStatusDomain = {
  domain: DomainMonitor;
  overview: DomainStatusOverview;
  pageSpeed?: {
    latestCheckedAt?: string | null;
    latestMobilePerformance?: number | null;
    latestDesktopPerformance?: number | null;
    trend7d?: string | null;
    lcpStatus?: 'good' | 'needs improvement' | 'poor' | 'unknown';
    lcpMs?: number | null;
    mainIssue?: string | null;
  };
};

export type PublicStatusReport = {
  owner: string | 'All';
  ownerSlug: string;
  generatedAt: string;
  summary: {
    domainCount: number;
    okCount: number;
    warningCount: number;
    errorCount: number;
  };
  domains: PublicStatusDomain[];
};

export type DomainHealthConfig = {
  checkPath: string;
  expectedStatusMin: number;
  expectedStatusMax: number;
  timeoutMs: number;
  warningResponseMs: number;
  errorResponseMs: number;
  followRedirects: boolean;
  tlsWarningDays: number;
};

export type DomainPayload = {
  name: string;
  baseUrl: string;
  owner?: DomainOwner;
  tenantId?: string | null;
  enabled: boolean;
  healthConfig: DomainHealthConfig;
};

@Injectable({ providedIn: 'root' })
export class DomainHealthService {
  private base = `${environment.apiUrl}/api`;

  constructor(private http: HttpClient) {}

  check(domain: string, selector: string) {
    return this.http.get<DomainHealthResult>(`${this.base}/domain-health`, {
      params: { domain, selector }
    });
  }

  listDomains() {
    return this.http.get<{ domains: DomainMonitor[]; monitor?: DomainMonitorRuntime }>(`${this.base}/domains`);
  }

  createDomain(payload: DomainPayload) {
    return this.http.post<{ domain: DomainMonitor }>(`${this.base}/domains`, payload);
  }

  updateDomain(id: string, payload: DomainPayload) {
    return this.http.patch<{ domain: DomainMonitor }>(`${this.base}/domains/${id}`, payload);
  }

  deleteDomain(id: string) {
    return this.http.delete<void>(`${this.base}/domains/${id}`);
  }

  checkNow(id: string) {
    return this.http.post<{ domain: DomainMonitor; check: DomainCheck }>(`${this.base}/domains/${id}/check-now`, {});
  }

  deepScan(id: string) {
    return this.http.post<DomainDeepScanResult>(`${this.base}/domains/${id}/deep-scan`, {});
  }

  getPageSpeed(id: string) {
    return this.http.get<DomainPageSpeedOverview>(`${this.base}/domains/${id}/pagespeed`);
  }

  runPageSpeed(id: string) {
    return this.http.post<DomainDeepScanResult>(`${this.base}/domains/${id}/pagespeed`, {});
  }

  getChecks(id: string, range: '24h' | '7d' | '30d') {
    return this.http.get<{ domain: DomainMonitor; checks: DomainCheck[]; overview: DomainStatusOverview }>(`${this.base}/domains/${id}/checks`, {
      params: { range }
    });
  }

  getPublicStatus(owner: string) {
    return this.http.get<PublicStatusReport>(`${this.base}/public/domain-status/${owner}`);
  }

  publicStatusPdfUrl(owner: string) {
    return `${this.base}/public/domain-status/${encodeURIComponent(owner)}/pdf`;
  }
}
