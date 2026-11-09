import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { WorkFieldFiles, WorkFieldSettings, WorkFieldValues, WorkReporting, WorkSettingsChange } from '../work-board/work-fields';

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
  constructor(private http: HttpClient) {}

  listWorks(options: { page?: number; limit?: number; search?: string; status?: string } = {}): Observable<WorkPage> {
    const params: Record<string, string> = {};
    if (options.page) params['page'] = String(options.page);
    if (options.limit) params['limit'] = String(options.limit);
    if (options.search) params['search'] = options.search;
    if (options.status) params['status'] = options.status;
    return this.http.get<WorkPage>(`${this.baseUrl}/works`, { params, withCredentials: true });
  }
  listActiveOptions(): Observable<WorkOption[]> {
    return this.http.get<{ works: WorkOption[] }>(`${this.baseUrl}/options`, { withCredentials: true }).pipe(map((res) => res.works || []));
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
    return this.http.post<{ client: WorkBoardClient; matchedExisting: boolean }>(`${this.baseUrl}/clients`, payload, { withCredentials: true });
  }
  listTenantUsers(): Observable<TenantUserOption[]> {
    return this.http.get<{ users: TenantUserOption[] }>(`${this.baseUrl}/users`, { withCredentials: true }).pipe(map((res) => res.users || []));
  }
  fieldSettings(): Observable<WorkFieldSettings> {
    return this.http.get<WorkFieldSettings>(`${this.baseUrl}/custom-fields`, { withCredentials: true });
  }
  dashboard(): Observable<WorkDashboard> {
    return this.http.get<WorkDashboard>(`${this.baseUrl}/dashboard`, { withCredentials: true });
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
    return this.http.put<WorkCurrencyPreference>(`${this.baseUrl}/default-currency`, { defaultCurrency }, { withCredentials: true });
  }
  saveFieldSettings(version: number, change: WorkSettingsChange): Observable<WorkFieldSettings> {
    return this.http.put<WorkFieldSettings>(`${this.baseUrl}/custom-fields`, { version, ...change }, { withCredentials: true });
  }
  downloadCustomField(workId: string, fieldId: string, archived: boolean): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/works/${workId}/custom-fields/${fieldId}/file`, {
      withCredentials: true, responseType: 'blob', params: { includeDeleted: archived }
    });
  }
  createWork(payload: WorkPayload, files: WorkFieldFiles = {}): Observable<WorkItem> {
    return this.http.post<{ work: WorkItem }>(`${this.baseUrl}/works`, this.workBody(payload, files), { withCredentials: true }).pipe(map((res) => res.work));
  }
  updateWork(id: string, payload: WorkPayload, files: WorkFieldFiles = {}): Observable<WorkItem> {
    return this.http.patch<{ work: WorkItem }>(`${this.baseUrl}/works/${id}`, this.workBody(payload, files), { withCredentials: true }).pipe(map((res) => res.work));
  }
  private workBody(payload: WorkPayload, files: WorkFieldFiles): WorkPayload | FormData {
    if (!Object.keys(files).length) return payload;
    const body = new FormData();
    body.append('payload', JSON.stringify(payload));
    for (const [id, file] of Object.entries(files)) body.append(`file.${id}`, file);
    return body;
  }
  archiveWork(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/works/${id}`, { withCredentials: true });
  }
  restoreWork(id: string): Observable<WorkItem> {
    return this.http.post<{ work: WorkItem }>(`${this.baseUrl}/works/${id}/restore`, {}, { withCredentials: true }).pipe(map((res) => res.work));
  }
  createSubWork(workId: string, payload: SubWorkPayload): Observable<SubWorkItem> {
    return this.http.post<{ subWork: SubWorkItem }>(`${this.baseUrl}/works/${workId}/sub-works`, payload, { withCredentials: true }).pipe(map((res) => res.subWork));
  }
  updateSubWork(id: string, payload: SubWorkPayload): Observable<SubWorkItem> {
    return this.http.patch<{ subWork: SubWorkItem }>(`${this.baseUrl}/sub-works/${id}`, payload, { withCredentials: true }).pipe(map((res) => res.subWork));
  }
  archiveSubWork(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/sub-works/${id}`, { withCredentials: true });
  }
  listDocuments(workId: string): Observable<WorkDocument[]> {
    return this.http.get<{ documents: WorkDocument[] }>(`${this.baseUrl}/works/${workId}/documents`, { withCredentials: true }).pipe(map((res) => res.documents || []));
  }
  uploadDocument(workId: string, file: File, category: string, customName = ''): Observable<WorkDocument> {
    const body = new FormData();
    body.append('file', file);
    body.append('category', category);
    if (customName) body.append('customName', customName);
    return this.http.post<{ document: WorkDocument }>(`${this.baseUrl}/works/${workId}/documents`, body, { withCredentials: true }).pipe(map((res) => res.document));
  }
  downloadDocument(documentId: string) {
    return this.http.get(`${this.baseUrl}/documents/${documentId}/file`, { responseType: 'blob', observe: 'response', withCredentials: true });
  }
  deleteDocument(documentId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/documents/${documentId}`, { withCredentials: true });
  }
}
