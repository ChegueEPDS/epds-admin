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

@Injectable({ providedIn: 'root' })
export class DomainHealthService {
  private base = `${environment.apiUrl}/api`;

  constructor(private http: HttpClient) {}

  check(domain: string, selector: string) {
    return this.http.get<DomainHealthResult>(`${this.base}/domain-health`, {
      params: { domain, selector }
    });
  }
}
