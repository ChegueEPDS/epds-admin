import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type EffortStatus = 'open' | 'closed';

export type EffortTask = {
  id: string;
  projectId: string;
  name: string;
  note: string;
  status: EffortStatus;
  netMs: number;
  grossMs: number;
  active: boolean;
  activeStartedAt: string | null;
  closedAt: string | null;
  closedNetMs: number;
  closedGrossMs: number;
  createdAt: string;
  updatedAt: string;
};

export type EffortProject = {
  id: string;
  name: string;
  customer: string;
  comment: string;
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
};

export type EffortTaskPayload = {
  name: string;
  note?: string;
};

@Injectable({ providedIn: 'root' })
export class EffortService {
  private baseUrl = `${environment.apiUrl}/api/effort`;

  constructor(private http: HttpClient) {}

  listProjects(): Observable<EffortProject[]> {
    return this.http.get<EffortProject[]>(`${this.baseUrl}/projects`, { withCredentials: true });
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

  createTask(projectId: string, payload: EffortTaskPayload): Observable<EffortTask> {
    return this.http.post<EffortTask>(`${this.baseUrl}/projects/${projectId}/tasks`, payload, { withCredentials: true });
  }

  updateTask(taskId: string, payload: EffortTaskPayload): Observable<EffortTask> {
    return this.http.patch<EffortTask>(`${this.baseUrl}/tasks/${taskId}`, payload, { withCredentials: true });
  }

  startTask(taskId: string): Observable<EffortTask> {
    return this.http.post<EffortTask>(`${this.baseUrl}/tasks/${taskId}/start`, {}, { withCredentials: true });
  }

  stopTask(taskId: string): Observable<EffortTask> {
    return this.http.post<EffortTask>(`${this.baseUrl}/tasks/${taskId}/stop`, {}, { withCredentials: true });
  }

  closeTask(taskId: string): Observable<EffortTask> {
    return this.http.post<EffortTask>(`${this.baseUrl}/tasks/${taskId}/close`, {}, { withCredentials: true });
  }
}
