import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { EMPTY, Observable, Subject, catchError, defer, expand, map, merge, switchMap, tap, timer } from 'rxjs';
import { environment } from '../../environments/environment';
import { WorkFieldFiles, WorkFieldSettings, WorkFieldValues, WorkReporting, WorkSettingsChange } from '../work-board/work-fields';
import { AuthService } from './auth.service';

export type WorkStatus = 'inquiry' | 'offer' | 'to_start' | 'in_progress' | 'on_hold' | 'completed_billable' | 'invoiced' | 'paid' | 'closed' | 'cancelled' | 'lost';

export type SubWorkItem = {
  id: string; workItemId: string; sequenceNumber: number; subWorkNumber: string; name: string; description: string;
  responsible: string; responsibleUserId: string | null; contributors: string[]; status: WorkStatus; deadline: string | null; completedAt: string | null;
  plannedHours: number; amount: number; currency: string; percentage: number; performanceCertificateRequired: boolean;
  performanceCertificateSigned: boolean; invoiceNumber: string; invoiceDate: string | null;
  invoicePaymentDeadline: string | null; paidAmount: number; paidAt: string | null; createdAt: string; updatedAt: string;
};

export type WorkItem = {
  id: string; workNumber: string; year: number; sequenceNumber: number; name: string; clientId: string | null; customer: string; responsibleUserId: string | null; responsible: string;
  entityId?: string | null; serviceTypeId?: string | null;
  reporting?: WorkReporting;
  contributors: string[]; status: WorkStatus; deadline: string | null; description: string; currency: string;
  totalAmount: number; costAmount: number; marginPercent: number; allocatedAmount: number; allocatedPercentage: number;
  remainingAmount: number; paidAmount: number; subcontractor: string; paymentDeadlineDays: number; offerDate: string | null;
  completionDate: string | null; invoiceDate: string | null; invoicePaymentDeadline: string | null; invoiceNumber: string;
  contractSigned: boolean; performanceCertificate: boolean; archivedAt: string | null; subWorkCount: number; subWorks: SubWorkItem[];
  createdAt: string; updatedAt: string;
  customFields?: WorkFieldValues; fieldRevision?: number;
};

export type WorkOption = {
  id: string; workNumber: string; name: string; customer: string; status: WorkStatus;
  subWorks: { id: string; sequenceNumber: number; subWorkNumber: string; name: string; status: WorkStatus }[];
};

export type WorkBoardClient = { id: string; taxNumber: string; name: string; country: string; postalCode: string; city: string; address: string; email: string; phone: string };
export type TenantUserOption = { id: string; fullName: string; email: string };
export type ActiveWorkValue = {
  amount: number | null; currency: string; rateDate: string | null; missingCurrencies: string[]; refreshFailed: boolean;
};
export type WorkCurrencyPreference = { defaultCurrency: string; currencies: string[] };
export type DashboardOwner = { active: number; leads: number; activeValue: ActiveWorkValue; pipelineValue: ActiveWorkValue;
  overdue: number; stale: number; attention: number };
export type DashboardCount = { label: string; count: number };
export type DashboardFilter = { kind: 'deadline' | 'finance' | 'entity'; value: string; entityId?: string };
export type DashboardWorks = {
  page: number; limit: number; total: number;
  works: { id: string; workNumber: string; name: string; responsible: string; stage: string; deadline: string | null;
    currency: string; amount: string | null; incomplete: boolean; missingRate: boolean }[];
};
export type WorkDashboard = {
  asOf: string; currency: string; rateDate: string | null; refreshFailed: boolean; paymentGaps: number;
  aedRateDerived?: boolean;
  summary: DashboardOwner & { receivable: ActiveWorkValue; unbilled: ActiveWorkValue };
  ownerTotal: DashboardOwner; owners: (DashboardOwner & { label: string })[];
  stages: string[]; entities: { id: string; label: string; counts: number[]; total: number }[];
  entityTotal: { counts: number[]; total: number };
  payments: { currency: string; contract: number | null; invoiced: number | null; paid: number | null; receivable: number | null;
    unbilled: number | null; reportingReceivable: ActiveWorkValue; reportingUnbilled: ActiveWorkValue }[];
  deadlines: DashboardCount[]; checks: DashboardCount[];
  finance: { key: string; label: string; value: ActiveWorkValue; count: number; incomplete: number }[];
  services: { label: string; active: number; leads: number; completed: number; value: ActiveWorkValue }[];
  sizes: { label: string; count: number; value: ActiveWorkValue; average: number | null; share: number | null }[] | null;
  totalSizeValue: ActiveWorkValue | null;
};
type DashboardSnapshot = WorkDashboard & { snapshotAt: string; refreshing: boolean; refreshError?: boolean };
type DashboardResponse = DashboardSnapshot | { snapshotAt?: never; refreshing: true; refreshError?: never };
type DashboardState = { report?: DashboardSnapshot; loading: boolean; error: string };
export type ClientPayload = Omit<WorkBoardClient, 'id'>;
export type WorkPage = {
  works: WorkItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: { activeCount: number; overdueCount: number; totalActiveValue: number | null; activeValue: ActiveWorkValue };
};
export type WorkDocument = {
  id: string; workItemId: string; category: string; categoryLabel: string; displayName: string; fileName: string;
  contentType: string; size: number; uploadedByName: string; uploadedAt: string;
};

export type WorkPayload = Partial<Omit<WorkItem, 'id' | 'workNumber' | 'sequenceNumber' | 'subWorks' | 'createdAt' | 'updatedAt'>> & { name: string };
export type SubWorkPayload = Partial<Omit<SubWorkItem, 'id' | 'workItemId' | 'sequenceNumber' | 'subWorkNumber' | 'percentage' | 'createdAt' | 'updatedAt'>> & { name: string };

@Injectable({ providedIn: 'root' })
export class WorkBoardService {
  private readonly baseUrl = `${environment.apiBaseUrl}/work-board`;
  private readonly dashboardCache = signal<DashboardState>({ loading: false, error: '' });
  readonly dashboardState = this.dashboardCache.asReadonly();
  private readonly dashboardRequests = new Subject<{ wait: boolean } | null>();
  private dashboardScope: string | null = null;

  constructor(private http: HttpClient, private auth: AuthService) {
    this.dashboardRequests.pipe(
      switchMap((request) => request ? timer(75).pipe(
        switchMap(() => this.fetchDashboard(request.wait)),
        expand((result, index) => result.refreshing && index < 5
          ? timer(300 * 2 ** index).pipe(switchMap(() => this.fetchDashboard(true)))
          : EMPTY),
        tap((result) => this.dashboardCache.update((state) => ({
          report: result.snapshotAt ? result : state.report,
          loading: result.refreshing,
          error: result.refreshError ? 'The dashboard could not be refreshed.' : ''
        }))),
        catchError((error) => {
          this.dashboardCache.update((state) => ({
            ...state, loading: false,
            error: error?.error?.error || 'The dashboard could not be loaded.'
          }));
          return EMPTY;
        }),
        tap({ complete: () => {
          if (this.dashboardCache().loading) {
            this.dashboardCache.update((state) => ({ ...state, loading: false, error: 'The dashboard is still being calculated.' }));
          }
        } })
      ) : EMPTY)
    ).subscribe();
    merge(this.auth.user$, this.auth.tenantContext$).subscribe(() => {
      const scope = this.currentDashboardScope();
      if (scope === this.dashboardScope) return;
      this.dashboardScope = scope;
      this.dashboardRequests.next(null);
      this.dashboardCache.set({ loading: false, error: '' });
    });
  }

  ensureDashboard(): void {
    const { report, loading, error } = this.dashboardCache();
    if (!report && !loading && !error) this.requestDashboard(false);
  }

  refreshDashboard(): void {
    this.requestDashboard(true);
  }

  private requestDashboard(wait: boolean): void {
    if (!this.dashboardScope) return;
    this.dashboardCache.update((state) => ({ ...state, loading: true, error: '' }));
    this.dashboardRequests.next({ wait });
  }

  private currentDashboardScope(): string | null {
    const user = this.auth.getCurrentUser();
    const tenant = this.auth.isSuperAdmin() ? this.auth.getTenantContextId() : user?.tenantId;
    return user && tenant && this.auth.isWorkFieldTenant() && this.auth.canAccessFeature('workBoard')
      ? JSON.stringify([user.id || user.userId, tenant])
      : null;
  }

  private fetchDashboard(wait: boolean): Observable<DashboardResponse> {
    return this.http.get<DashboardResponse>(`${this.baseUrl}/dashboard`, {
      withCredentials: true, params: wait ? { wait: '1' } : {}
    });
  }

  private refreshAfterSave<T>(request: Observable<T>): Observable<T> {
    return defer(() => {
      const scope = this.dashboardScope;
      return request.pipe(tap(() => {
        if (scope && scope === this.dashboardScope) this.refreshDashboard();
      }));
    });
  }

  listWorks(options: { page?: number; limit?: number; search?: string; status?: string; sort?: string; direction?: 'asc' | 'desc' } = {}): Observable<WorkPage> {
    const params: Record<string, string> = {};
    if (options.page) params['page'] = String(options.page);
    if (options.limit) params['limit'] = String(options.limit);
    if (options.search) params['search'] = options.search;
    if (options.status) params['status'] = options.status;
    if (options.sort) params['sort'] = options.sort;
    if (options.direction) params['direction'] = options.direction;
    return this.http.get<WorkPage>(`${this.baseUrl}/works`, { params, withCredentials: true });
  }
  listActiveOptions(): Observable<WorkOption[]> {
    return this.http.get<{ works: WorkOption[] }>(`${this.baseUrl}/options`, { withCredentials: true }).pipe(map((res) => res.works || []));
  }
  listBoardOptions(): Observable<WorkOption[]> {
    return this.http.get<{ works: WorkOption[] }>(`${this.baseUrl}/board-options`, { withCredentials: true }).pipe(map(res => res.works || []));
  }
  getWork(id: string): Observable<WorkItem> {
    return this.http.get<{ work: WorkItem }>(`${this.baseUrl}/works/${encodeURIComponent(id)}`, { withCredentials: true }).pipe(map((res) => res.work));
  }
  listClients(): Observable<WorkBoardClient[]> {
    return this.http.get<{ clients: WorkBoardClient[] }>(`${this.baseUrl}/clients`, { withCredentials: true }).pipe(map((res) => res.clients || []));
  }
  lookupClient(taxNumber: string): Observable<{ client: WorkBoardClient | null; linked: boolean }> {
    return this.http.get<{ client: WorkBoardClient | null; linked: boolean }>(`${this.baseUrl}/clients/lookup`, { params: { taxNumber }, withCredentials: true });
  }
  createOrLinkClient(payload: ClientPayload): Observable<{ client: WorkBoardClient; matchedExisting: boolean }> {
    return this.refreshAfterSave(this.http.post<{ client: WorkBoardClient; matchedExisting: boolean }>(`${this.baseUrl}/clients`, payload, { withCredentials: true }));
  }
  listTenantUsers(): Observable<TenantUserOption[]> {
    return this.http.get<{ users: TenantUserOption[] }>(`${this.baseUrl}/users`, { withCredentials: true }).pipe(map((res) => res.users || []));
  }
  fieldSettings(): Observable<WorkFieldSettings> {
    return this.http.get<WorkFieldSettings>(`${this.baseUrl}/custom-fields`, { withCredentials: true });
  }
  dashboardWorks(filter: DashboardFilter, page: number): Observable<DashboardWorks> {
    const params: Record<string, string> = { kind: filter.kind, value: filter.value, page: String(page) };
    if (filter.entityId !== undefined) params['entityId'] = filter.entityId;
    return this.http.get<DashboardWorks>(`${this.baseUrl}/dashboard/works`, { params, withCredentials: true });
  }
  currencyPreference(): Observable<WorkCurrencyPreference> {
    return this.http.get<WorkCurrencyPreference>(`${this.baseUrl}/default-currency`, { withCredentials: true });
  }
  saveCurrencyPreference(defaultCurrency: string): Observable<WorkCurrencyPreference> {
    return this.refreshAfterSave(this.http.put<WorkCurrencyPreference>(`${this.baseUrl}/default-currency`, { defaultCurrency }, { withCredentials: true }));
  }
  saveFieldSettings(version: number, change: WorkSettingsChange): Observable<WorkFieldSettings> {
    return this.refreshAfterSave(this.http.put<WorkFieldSettings>(`${this.baseUrl}/custom-fields`, { version, ...change }, { withCredentials: true }));
  }
  downloadCustomField(workId: string, fieldId: string, archived: boolean): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/works/${workId}/custom-fields/${fieldId}/file`, {
      withCredentials: true, responseType: 'blob', params: { includeDeleted: archived }
    });
  }
  createWork(payload: WorkPayload, files: WorkFieldFiles = {}): Observable<WorkItem> {
    return this.refreshAfterSave(this.http.post<{ work: WorkItem }>(`${this.baseUrl}/works`, this.workBody(payload, files), { withCredentials: true })).pipe(map((res) => res.work));
  }
  updateWork(id: string, payload: WorkPayload, files: WorkFieldFiles = {}): Observable<WorkItem> {
    return this.refreshAfterSave(this.http.patch<{ work: WorkItem }>(`${this.baseUrl}/works/${id}`, this.workBody(payload, files), { withCredentials: true })).pipe(map((res) => res.work));
  }
  private workBody(payload: WorkPayload, files: WorkFieldFiles): WorkPayload | FormData {
    if (!Object.keys(files).length) return payload;
    const body = new FormData();
    body.append('payload', JSON.stringify(payload));
    for (const [id, file] of Object.entries(files)) body.append(`file.${id}`, file);
    return body;
  }
  archiveWork(id: string): Observable<void> {
    return this.refreshAfterSave(this.http.delete<void>(`${this.baseUrl}/works/${id}`, { withCredentials: true }));
  }
  restoreWork(id: string): Observable<WorkItem> {
    return this.refreshAfterSave(this.http.post<{ work: WorkItem }>(`${this.baseUrl}/works/${id}/restore`, {}, { withCredentials: true })).pipe(map((res) => res.work));
  }
  createSubWork(workId: string, payload: SubWorkPayload): Observable<SubWorkItem> {
    return this.refreshAfterSave(this.http.post<{ subWork: SubWorkItem }>(`${this.baseUrl}/works/${workId}/sub-works`, payload, { withCredentials: true })).pipe(map((res) => res.subWork));
  }
  updateSubWork(id: string, payload: SubWorkPayload): Observable<SubWorkItem> {
    return this.refreshAfterSave(this.http.patch<{ subWork: SubWorkItem }>(`${this.baseUrl}/sub-works/${id}`, payload, { withCredentials: true })).pipe(map((res) => res.subWork));
  }
  archiveSubWork(id: string): Observable<void> {
    return this.refreshAfterSave(this.http.delete<void>(`${this.baseUrl}/sub-works/${id}`, { withCredentials: true }));
  }
  listDocuments(workId: string): Observable<WorkDocument[]> {
    return this.http.get<{ documents: WorkDocument[] }>(`${this.baseUrl}/works/${workId}/documents`, { withCredentials: true }).pipe(map((res) => res.documents || []));
  }
  uploadDocument(workId: string, file: File, category: string, customName = ''): Observable<WorkDocument> {
    const body = new FormData();
    body.append('file', file);
    body.append('category', category);
    if (customName) body.append('customName', customName);
    return this.refreshAfterSave(this.http.post<{ document: WorkDocument }>(`${this.baseUrl}/works/${workId}/documents`, body, { withCredentials: true })).pipe(map((res) => res.document));
  }
  downloadDocument(documentId: string) {
    return this.http.get(`${this.baseUrl}/documents/${documentId}/file`, { responseType: 'blob', observe: 'response', withCredentials: true });
  }
  deleteDocument(documentId: string): Observable<void> {
    return this.refreshAfterSave(this.http.delete<void>(`${this.baseUrl}/documents/${documentId}`, { withCredentials: true }));
  }
}
