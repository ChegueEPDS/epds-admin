import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface CatalogEntry { id: string; name: string; code?: string; archived?: boolean; }
export type FieldTarget = 'work' | 'subWork' | 'client' | 'group' | 'task';
export type FieldType = 'text' | 'longText' | 'number' | 'date' | 'boolean' | 'select' | 'multiSelect' | 'user' | 'url';
export type Value = string | number | boolean | string[] | null;
export type Custom = Record<string, Value>;
export interface Field { id: string; label: string; target: FieldTarget; type: FieldType; locations: string[]; options: CatalogEntry[]; required: boolean; archived?: boolean; }
export interface Rate { currency: string; effective: string; unitsPerEur: number; }
export interface Settings {
  units: CatalogEntry[]; services: CatalogEntry[]; fields: Field[]; rates: Rate[];
  smallLimit: number; mediumLimit: number; dueDays: number; staleDays: number; reviewDay: number;
  timezone: string; reminders: boolean; stageByStatus?: Record<string, string>;
}
export interface RecordData<T> { id: string; version: number; data: T; }
export interface BoardSettings extends RecordData<Settings> {
  users: CatalogEntry[]; canConfigure: boolean; tracker: boolean; canFinance: boolean;
}
export interface Group { name: string; description?: string; archived?: boolean; custom: Custom; }
export interface References {
  settings: RecordData<Settings>; users: CatalogEntry[]; groups: RecordData<Group>[];
  actor: string; canConfigure: boolean; canEdit: boolean; canFinance: boolean; canImport: boolean;
}
export interface WorkFields { unitId: string; custom: Custom; }
export interface Task { id: string; title: string; ownerId: string; due: string | null; done: boolean; custom?: Custom; }
export interface Payment { id: string; date: string; cents: number; reference?: string; reason?: string; kind?: string; voidedAt?: string; }
export interface Invoice { id: string; number: string; issued: string; due: string; cents: number; currency: string; payments: Payment[]; adjustments: Payment[]; allocations?: { subWorkId: string; cents: number }[]; voidedAt?: string; }
export interface Opening { invoicedCents: number | null; paidCents: number | null; due?: string; issued?: string; sourceStatus?: string; confirmed: boolean; payments?: Payment[]; adjustments?: Payment[]; }
export interface TrackerData extends Partial<WorkFields> {
  backupId?: string; serviceId?: string; groupId?: string; priority?: string; po?: string;
  start?: string; sharepoint?: string; remarks?: string; risk?: string; contractUnknown?: boolean; amountConfirmed?: boolean;
  reconciledOn?: string; tasks?: Task[]; nextTaskId?: string; invoices?: Invoice[]; opening?: Opening;
  audit?: { at: string; actor: string; action: string; details: string }[];
}
export interface TrackerRow {
  id: string; workNumber: string; name: string; customer: string; sourceClient: string; responsibleUserId: string | null;
  responsible: string; updatedAt?: string; archivedAt?: string; status: string; statusReason?: string; stage: string; currency: string; value: number | null; eur: number | null;
  payment: { status: string; invoiced: number; paid: number; credits: number; receivable: number | null; unbilled: number | null; overdue: boolean; };
  deadline: string | null; deadlineState: string; overdue: boolean; reviewDue: boolean; fxRate: number | null; action: Task | null; actionOverdue: boolean; reviewed: string | null;
  daysSinceReview: number | null; size: string; checks: string[]; unitId: string; groupId: string; serviceId: string;
  priority: string; backupId: string; po: string; custom: Custom;
}
export interface TrackerDetail extends RecordData<TrackerData> { work: TrackerRow; canEdit: boolean; canFinance: boolean; canCompleteActions: boolean; actor: string; subWorks: CatalogEntry[]; }
export interface Issue { workId: string; title: string; description: string; ownerId: string; closed: boolean; source?: string; }
export interface PreviewRow {
  no: string; name: string; unit: string; po: string; client: string; owner: string; status: string; amount: number | null; currency: string;
  checks: string[]; importedId?: string; matches: { id: string; name: string; workNumber: string }[];
}
export interface Preview { hash: string; rows: PreviewRow[]; questions: number; }
export interface ImportResult { results: { no: string; workId?: string; error?: string }[]; questions: number; }

@Injectable({ providedIn: 'root' })
export class ProjectTrackerService {
  private readonly http = inject(HttpClient);
  private readonly tracker = environment.apiBaseUrl + '/project-tracker';
  private readonly fields = environment.apiBaseUrl + '/work-fields';

  boardListFields(ids: string[]) { return this.http.get<RecordData<WorkFields>[]>(this.fields + '/works', { params: { ids: ids.join(',') } }); }
  boardSettings() { return this.http.get<BoardSettings>(this.fields + '/settings'); }
  saveSettings(version: number, data: Settings) { return this.http.put<RecordData<Settings>>(this.fields + '/settings', { version, data }); }
  boardFields(kind: FieldTarget, id: string) { return this.http.get<RecordData<WorkFields>>(`${this.fields}/${kind}/${id}`); }
  saveBoardFields(kind: FieldTarget, id: string, version: number, data: Partial<WorkFields>) {
    return this.http.patch<RecordData<WorkFields>>(`${this.fields}/${kind}/${id}`, { version, ...data });
  }
  references() { return this.http.get<References>(this.tracker + '/references'); }
  rows() { return this.http.get<{ rows: TrackerRow[]; asOf: string }>(this.tracker + '/works'); }
  detail(id: string) { return this.http.get<TrackerDetail>(this.tracker + '/works/' + id); }
  update(id: string, version: number, action: string, value: object = {}) {
    return this.http.patch(this.tracker + '/works/' + id, { version, action, value });
  }
  core(id: string, value: object) { return this.http.patch(this.tracker + '/works/' + id + '/core', value); }
  group(id: string, version: number, data: Group) {
    return this.http.put<RecordData<Group>>(this.tracker + '/groups/' + id, { version, data });
  }
  issues() { return this.http.get<RecordData<Issue>[]>(this.tracker + '/issues'); }
  issue(id: string, version: number, data: Issue) {
    return this.http.put<RecordData<Issue>>(this.tracker + '/issues/' + id, { version, data });
  }
  saveRates(version: number, rates: Rate[]) { return this.http.put(this.tracker + '/rates', { version, rates }); }
  preview(file: File, source: string) {
    const payload = new FormData();
    payload.append('file', file);
    payload.append('source', source);
    return this.http.post<Preview>(this.tracker + '/import/preview', payload);
  }
  apply(file: File, source: string, hash: string, decisions: object[], questions: boolean) {
    const payload = new FormData();
    payload.append('file', file);
    payload.append('source', source);
    payload.append('hash', hash);
    payload.append('decisions', JSON.stringify(decisions));
    payload.append('questions', String(questions));
    return this.http.post<ImportResult>(this.tracker + '/import/apply', payload);
  }
  export() { return this.http.get(this.tracker + '/export', { responseType: 'blob' }); }
}
