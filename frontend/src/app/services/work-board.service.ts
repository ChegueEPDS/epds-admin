import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

export type WorkStatus = 'inquiry' | 'offer' | 'in_progress' | 'completed_billable' | 'invoiced' | 'paid' | 'closed' | 'cancelled';

export type SubWorkItem = {
  id: string; workItemId: string; sequenceNumber: number; subWorkNumber: string; name: string; description: string;
  responsible: string; responsibleUserId: string | null; contributors: string[]; status: WorkStatus; deadline: string | null; completedAt: string | null;
  plannedHours: number; amount: number; currency: string; percentage: number; performanceCertificateRequired: boolean;
  performanceCertificateSigned: boolean; invoiceNumber: string; invoiceDate: string | null;
  invoicePaymentDeadline: string | null; paidAmount: number; paidAt: string | null; createdAt: string; updatedAt: string;
};

export type WorkItem = {
  id: string; workNumber: string; year: number; sequenceNumber: number; name: string; clientId: string | null; customer: string; responsibleUserId: string | null; responsible: string;
  contributors: string[]; status: WorkStatus; deadline: string | null; description: string; currency: string;
  totalAmount: number; costAmount: number; marginPercent: number; allocatedAmount: number; allocatedPercentage: number;
  remainingAmount: number; paidAmount: number; subcontractor: string; paymentDeadlineDays: number; offerDate: string | null;
  completionDate: string | null; invoiceDate: string | null; invoicePaymentDeadline: string | null; invoiceNumber: string;
  contractSigned: boolean; performanceCertificate: boolean; subWorkCount: number; subWorks: SubWorkItem[];
  createdAt: string; updatedAt: string;
};

export type WorkOption = {
  id: string; workNumber: string; name: string; customer: string; status: WorkStatus;
  subWorks: { id: string; sequenceNumber: number; subWorkNumber: string; name: string; status: WorkStatus }[];
};

export type WorkBoardClient = { id: string; taxNumber: string; name: string; country: string; postalCode: string; city: string; address: string; email: string; phone: string };
export type TenantUserOption = { id: string; fullName: string; email: string };
export type ClientPayload = Omit<WorkBoardClient, 'id'>;

export type WorkPayload = Partial<Omit<WorkItem, 'id' | 'workNumber' | 'sequenceNumber' | 'subWorks' | 'createdAt' | 'updatedAt'>> & { name: string };
export type SubWorkPayload = Partial<Omit<SubWorkItem, 'id' | 'workItemId' | 'sequenceNumber' | 'subWorkNumber' | 'percentage' | 'createdAt' | 'updatedAt'>> & { name: string };

@Injectable({ providedIn: 'root' })
export class WorkBoardService {
  private readonly baseUrl = `${environment.apiUrl}/api/work-board`;
  constructor(private http: HttpClient) {}

  listWorks(): Observable<WorkItem[]> {
    return this.http.get<{ works: WorkItem[] }>(`${this.baseUrl}/works`, { withCredentials: true }).pipe(map((res) => res.works || []));
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
  createSubWork(workId: string, payload: SubWorkPayload): Observable<SubWorkItem> {
    return this.http.post<{ subWork: SubWorkItem }>(`${this.baseUrl}/works/${workId}/sub-works`, payload, { withCredentials: true }).pipe(map((res) => res.subWork));
  }
  updateSubWork(id: string, payload: SubWorkPayload): Observable<SubWorkItem> {
    return this.http.patch<{ subWork: SubWorkItem }>(`${this.baseUrl}/sub-works/${id}`, payload, { withCredentials: true }).pipe(map((res) => res.subWork));
  }
  archiveSubWork(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/sub-works/${id}`, { withCredentials: true });
  }
}
