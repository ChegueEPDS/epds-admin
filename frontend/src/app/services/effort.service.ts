import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { TenantUserOption } from './work-board.service';

export type EffortStatus = 'open' | 'closed';
export type EffortTaskStatus = 'new' | 'in_progress' | 'closed';

export type EffortTask = {
  id: string;
  projectId: string;
  name: string;
  note: string;
  subWorkItemId: string | null;
  subWorkItem: { id: string | null; subWorkNumber: string; name: string } | null;
  status: EffortTaskStatus;
  assigneeId: string | null;
  assigneeName: string;
  estimateMs: number | null;
  measuredNetMs: number;
  netCorrections: { userId: string; userName?: string; at: string; reason: string; previousMs: number; netMs: number }[];
  timerPaused: boolean;
  netMs: number;
  grossMs: number;
  active: boolean;
  activeByCurrentUser: boolean;
  activeStartedAt: string | null;
  sessionCount: number;
  hasStarted: boolean;
  closedAt: string | null;
  closedNetMs: number;
  closedGrossMs: number;
  createdAt: string;
  updatedAt: string;
  displayBaseAt?: number;
};

export type EffortProject = {
  id: string;
  name: string;
  customer: string;
  comment: string;
  shared: boolean;
  workItemId: string | null;
  workItem: { id: string | null; workNumber: string; name: string; customer: string } | null;
  status: EffortStatus;
  netMs: number;
  grossMs: number;
  closedAt: string | null;
  closedNetMs: number;
  closedGrossMs: number;
  taskCount: number;
  openTaskCount: number;
  activeTaskCount: number;
  createdAt: string;
  updatedAt: string;
  tasks: EffortTask[];
};

export type EffortProjectPayload = {
  name: string;
  customer?: string;
  comment?: string;
  workItemId?: string | null;
  shared?: boolean;
};

export type EffortTaskPayload = {
  name: string;
  note?: string;
  subWorkItemId?: string | null;
  assigneeId?: string | null;
  estimateMs?: number | null;
  netOverrideMs?: number;
  netOverrideReason?: string;
  status?: EffortTaskStatus;
};

@Injectable({ providedIn: 'root' })
export class EffortService {
  private baseUrl = `${environment.apiBaseUrl}/effort`;

  constructor(private http: HttpClient) {}

  listProjects(board = false): Observable<EffortProject[]> {
    return this.http.get<EffortProject[]>(`${this.baseUrl}/projects`, { withCredentials: true, params: board ? { board: '1' } : {} });
  }

  listAssignees(): Observable<TenantUserOption[]> {
    return this.http.get<{ users: TenantUserOption[] }>(`${this.baseUrl}/assignees`, { withCredentials: true }).pipe(map(res => res.users));
  }

  getProject(id: string): Observable<EffortProject> {
    return this.http.get<EffortProject>(`${this.baseUrl}/projects/${id}`, { withCredentials: true });
  }

  createProject(payload: EffortProjectPayload): Observable<EffortProject> {
    return this.http.post<EffortProject>(`${this.baseUrl}/projects`, payload, { withCredentials: true });
  }

  updateProject(id: string, payload: EffortProjectPayload): Observable<EffortProject> {
    return this.http.patch<EffortProject>(`${this.baseUrl}/projects/${id}`, payload, { withCredentials: true });
  }

  closeProject(id: string): Observable<EffortProject> {
    return this.http.post<EffortProject>(`${this.baseUrl}/projects/${id}/close`, {}, { withCredentials: true });
  }

  reopenProject(id: string): Observable<EffortProject> {
    return this.http.post<EffortProject>(`${this.baseUrl}/projects/${id}/reopen`, {}, { withCredentials: true });
  }

  deleteProject(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/projects/${id}`, { withCredentials: true });
  }

  createTask(projectId: string, payload: EffortTaskPayload): Observable<EffortTask> {
    return this.http.post<EffortTask>(`${this.baseUrl}/projects/${projectId}/tasks`, payload, { withCredentials: true });
  }

  updateTask(taskId: string, payload: Partial<EffortTaskPayload>): Observable<EffortTask> {
    return this.http.patch<EffortTask>(`${this.baseUrl}/tasks/${taskId}`, payload, { withCredentials: true });
  }

  startTask(taskId: string): Observable<EffortTask> {
    return this.http.post<EffortTask>(`${this.baseUrl}/tasks/${taskId}/start`, {}, { withCredentials: true });
  }

  stopTask(taskId: string, pause = false): Observable<EffortTask> {
    return this.http.post<EffortTask>(`${this.baseUrl}/tasks/${taskId}/stop`, { pause }, { withCredentials: true });
  }

  closeTask(taskId: string): Observable<EffortTask> {
    return this.http.post<EffortTask>(`${this.baseUrl}/tasks/${taskId}/close`, {}, { withCredentials: true });
  }

  deleteTask(taskId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/tasks/${taskId}`, { withCredentials: true });
  }
}
