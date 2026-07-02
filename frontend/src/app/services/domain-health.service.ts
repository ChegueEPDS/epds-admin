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
export type DomainOwner = 'Stahl' | 'Robex' | 'Veproil' | 'ExNB/Exva' | 'Ind-Ex' | 'EPDS';

export type DomainMonitor = {
  id: string;
  name: string;
  baseUrl: string;
  owner: DomainOwner;
  tenantId?: string | null;
  enabled: boolean;
  lastCheckedAt?: string;
  lastStatus: DomainMonitorStatus;
  displayStatus: DomainMonitorStatus;
  lastResponseMs?: number;
  lastStatusCode?: number;
  lastError?: string;
  lastErrorType?: string;
  currentIssueSince?: string;
  lastFailureAt?: string;
  lastRecoveryAt?: string;
  recentIssueCount: number;
  availability?: {
    status: DomainMonitorStatus;
    uptimePercent: number | null;
    totalChecks: number;
    recentIssueCount: number;
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
  statusCode?: number;
  responseMs?: number;
  errorType?: string;
  errorMessage?: string;
};

export type PageSpeedMetric = {
  id: string;
  title?: string;
  displayValue?: string | null;
  numericValue?: number | null;
  score?: number | null;
};

export type DomainDeepScanResult = {
  checkedAt: string;
  domain: DomainMonitor;
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

export type DomainPayload = {
  name: string;
  baseUrl: string;
  owner: DomainOwner;
  enabled: boolean;
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
    return this.http.get<{ domains: DomainMonitor[] }>(`${this.base}/domains`);
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

  getChecks(id: string, range: '24h' | '7d' | '30d') {
    return this.http.get<{ domain: DomainMonitor; checks: DomainCheck[] }>(`${this.base}/domains/${id}/checks`, {
      params: { range }
    });
  }
}
