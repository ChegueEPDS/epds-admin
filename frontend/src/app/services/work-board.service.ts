import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

export type WorkStatus = 'inquiry' | 'offer' | 'in_progress' | 'to_start' | 'on_hold' | 'lost' | 'completed_billable' | 'invoiced' | 'paid' | 'closed' | 'cancelled';

export type SubWorkItem = {
  id: string; workItemId: string; sequenceNumber: number; subWorkNumber: string; name: string; description: string;
  responsible: string; responsibleUserId: string | null; contributors: string[]; status: WorkStatus; deadline: string | null; completedAt: string | null;
  plannedHours: number; amount: number; currency: string; percentage: number; performanceCertificateRequired: boolean;
  performanceCertificateSigned: boolean; invoiceNumber: string; invoiceDate: string | null;
  invoicePaymentDeadline: string | null; paidAmount: number; paidAt: string | null; createdAt: string; updatedAt: string;
};

export type WorkItem = {
  id: string; workNumber: string; year: number; sequenceNumber: number; name: string; clientId: string | null; customer: string; responsibleUserId: string | null; responsible: string;
  contributors: string[]; status: WorkStatus; statusReason?: string; deadline: string | null; description: string; currency: string;
  totalAmount: number; costAmount: number; marginPercent: number; allocatedAmount: number; allocatedPercentage: number;
  remainingAmount: number; paidAmount: number; subcontractor: string; paymentDeadlineDays: number; offerDate: string | null;
  completionDate: string | null; invoiceDate: string | null; invoicePaymentDeadline: string | null; invoiceNumber: string;
  contractSigned: boolean; performanceCertificate: boolean; archivedAt: string | null; subWorkCount: number; subWorks: SubWorkItem[];
  createdAt: string; updatedAt: string;
};

export type WorkOption = {
  id: string; workNumber: string; name: string; customer: string; status: WorkStatus;
  subWorks: { id: string; sequenceNumber: number; subWorkNumber: string; name: string; status: WorkStatus }[];
};

export type WorkBoardClient = { id: string; taxNumber: string; name: string; country: string; postalCode: string; city: string; address: string; email: string; phone: string };
export type TenantUserOption = { id: string; fullName: string; email: string };
export type ClientPayload = Omit<WorkBoardClient, 'id'>;
export type WorkPage = {
  works: WorkItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: { activeCount: number; overdueCount: number; totalActiveValue: number; activeValues?: { currency: string; value: number }[] };
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

  listWorks(options: { page?: number; limit?: number; search?: string; status?: string; unitId?: string } = {}): Observable<WorkPage> {
    const params: Record<string, string> = {};
    if (options.page) params['page'] = String(options.page);
    if (options.limit) params['limit'] = String(options.limit);
    if (options.search) params['search'] = options.search;
    if (options.status) params['status'] = options.status;
    if (options.unitId) params['unitId'] = options.unitId;
    return this.http.get<WorkPage>(`${this.baseUrl}/works`, { params, withCredentials: true });
  }
  getWork(id: string, archived = false): Observable<WorkItem> {
    return this.http.get<{ work: WorkItem }>(`${this.baseUrl}/works/${id}`, { withCredentials: true, params: { includeDeleted: archived } }).pipe(map((res) => res.work));
  }
  listActiveOptions(): Observable<WorkOption[]> {
    return this.http.get<{ works: WorkOption[] }>(`${this.baseUrl}/options`, { withCredentials: true }).pipe(map((res) => res.works || []));
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
  createWork(payload: WorkPayload): Observable<WorkItem> {
    return this.http.post<{ work: WorkItem }>(`${this.baseUrl}/works`, payload, { withCredentials: true }).pipe(map((res) => res.work));
  }
  updateWork(id: string, payload: WorkPayload): Observable<WorkItem> {
    return this.http.patch<{ work: WorkItem }>(`${this.baseUrl}/works/${id}`, payload, { withCredentials: true }).pipe(map((res) => res.work));
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
