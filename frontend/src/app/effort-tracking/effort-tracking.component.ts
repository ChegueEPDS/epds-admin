import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, HostListener, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { combineLatest, firstValueFrom, Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EffortProject, EffortService, EffortTask, EffortTaskPayload, EffortTaskStatus } from '../services/effort.service';
import { RichTextEditorComponent } from '../shared/rich-text-editor/rich-text-editor.component';
import { AuthService } from '../services/auth.service';
import { TenantUserOption, WorkBoardClient, WorkBoardService, WorkOption } from '../services/work-board.service';
import { WorkField, WorkFieldFiles, WorkFieldValues } from '../work-board/work-fields';
import { WorkFieldValuesComponent } from '../work-board/work-field-values.component';

const lanes = [
  { id: 'new', label: 'Új' },
  { id: 'in_progress', label: 'Folyamatban' },
  { id: 'closed', label: 'Lezárt' }
] as const;
const all = '*';
const minutesToMs = (minutes: number) => Math.round(minutes * 60_000);

type Row = {
  id: string;
  name: string;
  work: WorkOption | null;
  workNumber: string;
  customer: string;
  projects: EffortProject[];
  tasks: EffortTask[];
  subWorks: { id: string; name: string; subWorkNumber: string }[];
  dropIds: string[];
};

type VisibleRow = Row & { byStatus: Record<EffortTaskStatus, EffortTask[]> };

@Component({
  selector: 'app-effort-tracking',
  standalone: true,
  imports: [
    CommonModule, RouterLink, FormsModule, DragDropModule, MatButtonModule, MatDialogModule, MatIconModule,
    MatMenuModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule, RichTextEditorComponent, WorkFieldValuesComponent
  ],
  templateUrl: './effort-tracking.component.html',
  styleUrl: './effort-tracking.component.scss'
})
export class EffortTrackingComponent implements OnInit, OnDestroy {
  @ViewChild('taskEditor', { static: true }) private taskEditor!: TemplateRef<unknown>;
  @ViewChild('projectEditor', { static: true }) private projectEditor!: TemplateRef<unknown>;

  readonly lanes = lanes;
  readonly all = all;
  readonly unassigned = '';
  rows: Row[] = [];
  visibleRows: VisibleRow[] = [];
  laneCounts = { new: 0, in_progress: 0, closed: 0 };
  filters = { project: all, who: all, status: all, sub: all };
  subFilters: { id: string; label: string }[] = [];
  people: TenantUserOption[] = [];
  peopleById = new Map<string, string>();
  collapsed = new Set<string>();
  activeTask: EffortTask | null = null;
  now = Date.now();
  loading = true;
  saving = false;
  loadError = '';
  editorError = '';
  rowInEditor: Row | null = null;
  taskInEditor: EffortTask | null = null;
  taskForm = this.emptyTaskForm();
  projectInEditor: EffortProject | null = null;
  projectForm = this.emptyProjectForm();
  projectEditorMode: 'work' | 'personal' = 'work';
  projectEditorLoading = false;
  clients: WorkBoardClient[] = [];
  fields: WorkField[] = [];
  fieldChanges: WorkFieldValues = {};
  fieldFiles: WorkFieldFiles = {};

  private projects: EffortProject[] = [];
  private works: WorkOption[] = [];
  private projectsById = new Map<string, EffortProject>();
  private scopeSubscription?: Subscription;
  private scopeKey: string | null = null;
  private scopeVersion = 0;
  private requestId = 0;
  private refreshInFlight = false;
  private tickId?: ReturnType<typeof setInterval>;
  private dialogRef?: MatDialogRef<unknown>;
  private readonly originalTitle = document.title || 'EPDS Admin';

  constructor(
    private effort: EffortService,
    private workBoard: WorkBoardService,
    private dialogs: MatDialog,
    private snackBar: MatSnackBar,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.scopeSubscription = combineLatest([this.auth.user$, this.auth.tenantContext$]).subscribe(([user, context]) => {
      const tenant = this.auth.isSuperAdmin() ? context?.id : user?.tenantId;
      const key = tenant && user ? JSON.stringify([user.id || user.userId, tenant,
        this.auth.canAccessFeature('effortTracking'), this.auth.canAccessFeature('workBoard')]) : '';
      if (this.scopeKey === key) return;
      this.scopeKey = key;
      this.scopeVersion++;
      this.dialogRef?.close();
      this.dialogRef = undefined;
      this.projects = [];
      this.works = [];
      this.people = [];
      this.peopleById.clear();
      this.collapsed.clear();
      this.resetFilters();
      this.saving = false;
      this.refreshInFlight = false;
      this.rebuildBoard();
      void this.load();
    });
    this.tickId = setInterval(() => {
      if (!this.activeTask && !this.rows.some(row => row.tasks.some(task => task.active))) return;
      this.now = Date.now();
      this.updateTitle();
    }, 1000);
  }

  ngOnDestroy(): void {
    this.scopeVersion++;
    this.scopeSubscription?.unsubscribe();
    this.dialogRef?.close();
    if (this.tickId) clearInterval(this.tickId);
    document.title = this.originalTitle;
  }

  @HostListener('window:focus')
  refreshOnFocus(): void {
    if (!this.loading && !this.loadError && !this.saving && !this.dialogRef && !this.refreshInFlight) void this.load(false);
  }

  get canEdit(): boolean { return this.auth.canEditFeature('effortTracking'); }
  get canDelete(): boolean { return this.auth.canDeleteFeature('effortTracking'); }
  get canCreateWork(): boolean { return Boolean(this.scopeKey) && this.canEdit && this.auth.canEditFeature('workBoard'); }
  get anyOpen(): boolean { return this.visibleRows.some(row => !this.collapsed.has(row.id)); }
  get toggleLabel(): string { return this.anyOpen ? 'Összes összecsukása' : 'Összes kinyitása'; }
  get availableWorks(): WorkOption[] { return this.works; }
  get editableTask(): boolean { return this.canEdit && (!this.taskInEditor || this.canEditTask(this.taskInEditor)); }
  get editableProject(): boolean { return this.canEdit && this.projectInEditor?.status !== 'closed'; }

  async load(showLoading = true): Promise<void> {
    if (!this.scopeKey || !this.auth.canAccessFeature('effortTracking')) {
      this.loadError = 'A tábla megnyitásához válassz hozzáférhető szervezetet.';
      this.loading = false;
      return;
    }
    const version = this.scopeVersion;
    const id = ++this.requestId;
    this.refreshInFlight = true;
    if (showLoading) this.loading = true;
    this.loadError = '';
    try {
      const [projects, works, people] = await Promise.all([
        firstValueFrom(this.effort.listProjects(true)),
        this.auth.canAccessFeature('workBoard') ? firstValueFrom(this.workBoard.listBoardOptions()) : Promise.resolve([]),
        firstValueFrom(this.effort.listAssignees())
      ]);
      if (version !== this.scopeVersion || id !== this.requestId) return;
      const displayBaseAt = Date.now();
      this.projects = projects.map(project => ({ ...project,
        tasks: project.tasks.map(task => ({ ...task, displayBaseAt })) }));
      this.works = works;
      this.people = people;
      this.peopleById = new Map(people.map(person => [person.id, person.fullName]));
      this.rebuildBoard();
    } catch (error) {
      if (version !== this.scopeVersion || id !== this.requestId) return;
      const message = this.message(error, 'Az Effort Tracking tábla betöltése sikertelen.');
      if (showLoading) this.loadError = message;
      else this.notice(message);
    } finally {
      if (version === this.scopeVersion && id === this.requestId) {
        this.loading = false;
        this.refreshInFlight = false;
      }
    }
  }

  private rebuildBoard(): void {
    const byId = new Map<string, Row>();
    const makeRow = (id: string, name: string, work: WorkOption | null, workNumber: string, customer: string): Row => ({
      id, name, work, workNumber, customer, projects: [], tasks: [],
      subWorks: [...(work?.subWorks || [])], dropIds: this.lanes.map(lane => `${id}-${lane.id}`)
    });
    for (const work of this.works) {
      const id = `work-${work.id}`;
      byId.set(id, makeRow(id, work.name, work, work.workNumber, work.customer));
    }
    this.projectsById = new Map(this.projects.map(project => [project.id, project]));
    for (const project of this.projects) {
      const workId = project.workItemId ? `work-${project.workItemId}` : '';
      const id = (project.shared || byId.has(workId)) && workId ? workId : `effort-${project.id}`;
      const row = byId.get(id) ?? makeRow(id, project.workItem?.name || project.name, null,
        project.workItem?.workNumber || '', project.workItem?.customer || project.customer);
      row.projects.push(project);
      row.tasks.push(...project.tasks);
      for (const task of project.tasks) {
        const sub = task.subWorkItem;
        if (sub?.id && !row.subWorks.some(item => item.id === sub.id)) row.subWorks.push({ ...sub, id: sub.id });
      }
      byId.set(id, row);
    }
    this.rows = [...byId.values()];
    this.activeTask = this.projects.flatMap(project => project.tasks).find(task => task.activeByCurrentUser) || null;
    this.now = Date.now();
    this.applyFilters();
    this.updateTitle();
  }

  applyFilters(): void {
    if (this.filters.project !== all && !this.rows.some(row => row.id === this.filters.project)) this.filters.project = all;
    const rows = this.rows.filter(row => this.filters.project === all || this.filters.project === row.id);
    this.subFilters = rows.flatMap(row => row.subWorks.map(sub => ({ id: sub.id,
      label: this.filters.project === all ? `${row.workNumber || row.name} · ${sub.name}` : sub.name })));
    if (this.filters.sub !== all && !this.subFilters.some(sub => sub.id === this.filters.sub)) this.filters.sub = all;
    const taskFilter = [this.filters.who, this.filters.status, this.filters.sub].some(value => value !== all);
    this.laneCounts = { new: 0, in_progress: 0, closed: 0 };
    this.visibleRows = [];
    for (const row of rows) {
      const byStatus: VisibleRow['byStatus'] = { new: [], in_progress: [], closed: [] };
      let matches = 0;
      for (const task of row.tasks) {
        if (this.filters.who !== all && this.filters.who !== (task.assigneeId || this.unassigned)) continue;
        if (this.filters.status !== all && this.filters.status !== task.status) continue;
        if (this.filters.sub !== all && this.filters.sub !== task.subWorkItemId) continue;
        byStatus[task.status].push(task);
        this.laneCounts[task.status]++;
        matches++;
      }
      if (!taskFilter || matches) this.visibleRows.push({ ...row, byStatus });
    }
  }

  toggleAll(): void {
    const close = this.anyOpen;
    for (const row of this.visibleRows) {
      if (close) this.collapsed.add(row.id);
      else this.collapsed.delete(row.id);
    }
  }

  toggleRow(row: Row): void {
    if (this.collapsed.has(row.id)) this.collapsed.delete(row.id);
    else this.collapsed.add(row.id);
  }

  showActiveTask(): void {
    const task = this.activeTask;
    if (!task) return;
    const row = this.rows.find(item => item.tasks.includes(task));
    if (!row) return;
    if (!this.visibleRows.some(item => item.byStatus.in_progress.includes(task))) {
      this.resetFilters();
      this.applyFilters();
    }
    this.collapsed.delete(row.id);
    requestAnimationFrame(() => {
      const card = document.getElementById(`effort-task-${task.id}`);
      card?.scrollIntoView({ block: 'nearest' });
      card?.querySelector<HTMLButtonElement>('.task-editor-button')?.focus({ preventScroll: true });
    });
  }

  canEditTask(task: EffortTask): boolean {
    return this.canEdit && this.projectsById.get(task.projectId)?.status === 'open';
  }

  canAddTask(row: Row): boolean {
    return this.canEdit && (Boolean(row.work) || row.projects.some(project => !project.shared && project.status === 'open'));
  }

  personalProjects(row: Row): EffortProject[] { return row.projects.filter(project => !project.shared); }

  startTaskEditor(row: Row, task?: EffortTask): void {
    if (this.saving || this.dialogRef || (!task && !this.canAddTask(row))) return;
    this.rowInEditor = row;
    this.taskInEditor = task ?? null;
    this.taskForm = task ? {
      name: task.name, note: task.note, sub: task.subWorkItemId || '', who: task.assigneeId || '',
      estimate: task.estimateMs === null ? null : task.estimateMs / 60_000,
      net: null, reason: ''
    } : this.emptyTaskForm();
    this.openDialog(this.taskEditor);
  }

  get taskSubOptions(): WorkOption['subWorks'] {
    const row = this.rowInEditor;
    const project = this.taskInEditor ? this.projectsById.get(this.taskInEditor.projectId) : null;
    if (project && project.workItemId !== row?.work?.id) {
      return this.works.find(work => work.id === project.workItemId)?.subWorks || [];
    }
    return row?.work?.subWorks || [];
  }

  taskSubOptionsById(id: string): boolean { return this.taskSubOptions.some(sub => sub.id === id); }
  hasWork(id: string): boolean { return this.works.some(work => work.id === id); }

  async saveTask(): Promise<void> {
    const row = this.rowInEditor;
    const task = this.taskInEditor;
    const form = this.taskForm;
    if (!row || !this.editableTask || !form.name.trim()) return;
    const payload: EffortTaskPayload = {
      name: form.name.trim(), note: form.note, subWorkItemId: form.sub || null,
      assigneeId: form.who || null, estimateMs: form.estimate === null ? null : minutesToMs(form.estimate)
    };
    if (form.net !== null && !task?.active) {
      if (!form.reason.trim()) {
        this.editorError = 'Add meg az időkorrekció indokát.';
        return;
      }
      payload.netOverrideMs = minutesToMs(form.net);
      payload.netOverrideReason = form.reason.trim();
    }

    await this.mutate(async (ensureScope) => {
      let project = task ? this.projectsById.get(task.projectId) : row.work
        ? row.projects.find(item => item.shared) : row.projects.find(item => !item.shared && item.status === 'open');
      if (!project && row.work) {
        project = await firstValueFrom(this.effort.createProject({ name: row.name, workItemId: row.work.id, shared: true }));
        ensureScope();
        this.storeProject(project);
      }
      if (!project) throw new Error('A feladathoz nem található nyitott projekt.');
      const saved = await firstValueFrom(task ? this.effort.updateTask(task.id, payload) : this.effort.createTask(project.id, payload));
      ensureScope();
      this.storeTask(saved);
      this.collapsed.delete(row.id);
      this.dialogRef?.close();
    }, 'A feladat mentése sikertelen.', 'Feladat mentve.');
  }

  async changeStatus(task: EffortTask, status: EffortTaskStatus): Promise<void> {
    if (!this.canEditTask(task) || task.status === status) return;
    await this.mutate(async (ensureScope) => {
      const saved = await firstValueFrom(this.effort.updateTask(task.id, { status }));
      ensureScope();
      this.storeTask(saved);
    }, 'A státuszváltás sikertelen.', task.active ? 'Státusz módosítva, a mérés rögzítve.' : 'Státusz módosítva.');
  }

  drop(event: CdkDragDrop<EffortTaskStatus, EffortTaskStatus, EffortTask>): void {
    if (event.isPointerOverContainer && event.container !== event.previousContainer) {
      void this.changeStatus(event.item.data, event.container.data);
    }
  }

  async changeAssignee(task: EffortTask, assignee: string): Promise<void> {
    if (!this.canEditTask(task) || assignee === (task.assigneeId || '')) return;
    await this.mutate(async (ensureScope) => {
      const saved = await firstValueFrom(this.effort.updateTask(task.id, { assigneeId: assignee || null }));
      ensureScope();
      this.storeTask(saved);
    }, 'A felelős módosítása sikertelen.', 'Felelős módosítva.');
  }

  timerLabel(task: EffortTask): string {
    return task.activeByCurrentUser ? 'Szünet' : task.timerPaused ? 'Folytatás' : 'Indítás';
  }

  async toggleTimer(task: EffortTask): Promise<void> {
    if (!this.canEditTask(task) || task.status !== 'in_progress') return;
    if (this.activeTask && this.activeTask.id !== task.id) {
      this.notice(`Előbb szüneteltesd vagy állítsd meg a futó mérést: ${this.activeTask.name}.`);
      return;
    }
    const request = task.activeByCurrentUser ? this.effort.stopTask(task.id, true) : this.effort.startTask(task.id);
    await this.mutate(async (ensureScope) => {
      const saved = await firstValueFrom(request);
      ensureScope();
      this.storeTask(saved);
    }, 'Az időmérő módosítása sikertelen.');
  }

  async stopTimer(task: EffortTask): Promise<void> {
    if (!this.canEditTask(task) || (task.active && !task.activeByCurrentUser)) return;
    await this.mutate(async (ensureScope) => {
      const saved = await firstValueFrom(this.effort.stopTask(task.id));
      ensureScope();
      this.storeTask(saved);
    }, 'A mérés leállítása sikertelen.', 'Mérés rögzítve.');
  }

  async deleteTask(task: EffortTask): Promise<void> {
    if (!this.canDelete || task.active || !confirm(`Végleg törlöd a feladatot és a hozzá tartozó méréseket?\n\n${task.name}`)) return;
    await this.mutate(async (ensureScope) => {
      await firstValueFrom(this.effort.deleteTask(task.id));
      ensureScope();
      const project = this.projectsById.get(task.projectId);
      if (project) this.storeProject({ ...project, tasks: project.tasks.filter(item => item.id !== task.id) });
      this.dialogRef?.close();
    }, 'A feladat törlése sikertelen.', 'Feladat törölve.');
  }

  async startProjectEditor(project?: EffortProject): Promise<void> {
    if (this.saving || this.dialogRef || (!project && !this.canCreateWork && !this.canEdit)) return;
    this.projectEditorMode = project || !this.canCreateWork ? 'personal' : 'work';
    this.projectInEditor = project ?? null;
    this.projectForm = project ? {
      ...this.emptyProjectForm(), name: project.name, customer: project.customer, note: project.comment, work: project.workItemId || ''
    } : this.emptyProjectForm();
    this.fields = [];
    this.fieldChanges = {};
    this.fieldFiles = {};
    this.projectEditorLoading = this.projectEditorMode === 'work';
    this.openDialog(this.projectEditor);
    if (this.projectEditorMode !== 'work') return;
    const dialog = this.dialogRef;
    try {
      const [clients, settings] = await Promise.all([
        firstValueFrom(this.workBoard.listClients()),
        this.auth.isWorkFieldTenant() ? firstValueFrom(this.workBoard.fieldSettings()) : Promise.resolve(null)
      ]);
      if (this.dialogRef !== dialog) return;
      this.clients = clients;
      this.fields = (settings?.fields || []).filter(field => !field.archived && ['basic', 'description', 'documents'].includes(field.card));
    } catch (error) {
      if (this.dialogRef !== dialog) return;
      this.editorError = this.message(error, 'A projekt űrlapja nem tölthető be.');
    } finally {
      if (this.dialogRef === dialog) this.projectEditorLoading = false;
    }
  }

  async saveProject(): Promise<void> {
    const form = this.projectForm;
    const name = form.name.trim();
    if (!name || !this.editableProject || this.projectEditorLoading) return;
    await this.mutate(async (ensureScope) => {
      if (this.projectEditorMode === 'work') {
        const work = await firstValueFrom(this.workBoard.createWork({
          name, clientId: form.client || null, description: form.note,
          customFields: this.fieldChanges
        }, this.fieldFiles));
        ensureScope();
        this.works = [{ ...work, subWorks: work.subWorks || [] }, ...this.works];
        this.collapsed.delete(`work-${work.id}`);
      } else {
        const payload = { name, customer: form.customer, comment: form.note, workItemId: form.work || null };
        const project = await firstValueFrom(this.projectInEditor
          ? this.effort.updateProject(this.projectInEditor.id, payload)
          : this.effort.createProject(payload));
        ensureScope();
        this.storeProject(project);
        this.collapsed.delete(project.workItemId ? `work-${project.workItemId}` : `effort-${project.id}`);
      }
      this.resetFilters();
      this.rebuildBoard();
      this.dialogRef?.close();
    }, 'A projekt mentése sikertelen.', 'Projekt mentve.');
  }

  async changePersonalProject(project: EffortProject, action: 'close' | 'reopen' | 'delete'): Promise<void> {
    if (this.saving || (action === 'delete' ? !this.canDelete : !this.canEdit)) return;
    if (action === 'delete' && !confirm(`Végleg törlöd a személyes projektet a feladataival és méréseivel együtt?\n\n${project.name}`)) return;
    if (action === 'close' && !confirm(`Lezárod a személyes projektet és minden feladatát?\n\n${project.name}`)) return;
    await this.mutate(async (ensureScope) => {
      if (action === 'delete') {
        await firstValueFrom(this.effort.deleteProject(project.id));
        ensureScope();
        this.projects = this.projects.filter(item => item.id !== project.id);
        this.rebuildBoard();
      } else {
        const saved = await firstValueFrom(action === 'close' ? this.effort.closeProject(project.id) : this.effort.reopenProject(project.id));
        ensureScope();
        this.storeProject(saved);
      }
    }, 'A projekt módosítása sikertelen.');
  }

  taskNet(task: EffortTask): number {
    return task.netMs + (task.active ? Math.max(0, this.now - (task.displayBaseAt ?? this.now)) : 0);
  }

  rowNet(row: Row): number { return row.tasks.reduce((sum, task) => sum + this.taskNet(task), 0); }

  formatDuration(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const seconds = total % 60;
    return hours ? `${hours} ó ${minutes} p ${seconds} mp` : `${minutes} p ${seconds} mp`;
  }

  private openDialog(template: TemplateRef<unknown>): void {
    this.editorError = '';
    const ref = this.dialogs.open(template, { width: '570px', maxWidth: 'calc(100vw - 24px)' });
    this.dialogRef = ref;
    ref.afterClosed().subscribe(() => { if (this.dialogRef === ref) this.dialogRef = undefined; });
  }

  private storeTask(task: EffortTask): void {
    const project = this.projectsById.get(task.projectId);
    if (!project) return;
    const stamped = { ...task, displayBaseAt: Date.now() };
    const tasks = project.tasks.some(item => item.id === task.id)
      ? project.tasks.map(item => item.id === task.id ? stamped : item)
      : [...project.tasks, stamped];
    this.storeProject({ ...project, tasks });
  }

  private storeProject(project: EffortProject): void {
    const displayBaseAt = Date.now();
    project = { ...project, tasks: project.tasks.map(task => task.displayBaseAt ? task : { ...task, displayBaseAt }) };
    this.projects = this.projects.some(item => item.id === project.id)
      ? this.projects.map(item => item.id === project.id ? project : item)
      : [...this.projects, project];
    this.rebuildBoard();
  }

  private async mutate(action: (ensureScope: () => void) => Promise<void>, fallback: string, success?: string): Promise<void> {
    if (this.saving) return;
    const version = this.scopeVersion;
    const dialog = this.dialogRef;
    const ensureScope = () => {
      if (version !== this.scopeVersion) throw new Error('The selected organization changed');
    };
    this.saving = true;
    this.requestId++;
    this.refreshInFlight = false;
    this.editorError = '';
    if (dialog) dialog.disableClose = true;
    try {
      await action(ensureScope);
      if (version === this.scopeVersion && success) this.notice(success);
    } catch (error) {
      if (version !== this.scopeVersion) return;
      const message = this.message(error, fallback);
      if (dialog) this.editorError = message;
      else this.notice(message);
      if (error instanceof HttpErrorResponse && error.status === 409) void this.load(false);
    } finally {
      if (version === this.scopeVersion) this.saving = false;
      if (dialog) dialog.disableClose = false;
    }
  }

  private resetFilters(): void { this.filters = { project: all, who: all, status: all, sub: all }; }
  private emptyTaskForm() {
    return { name: '', note: '', sub: '', who: '', estimate: null as number | null, net: null as number | null, reason: '' };
  }
  private emptyProjectForm() { return { name: '', customer: '', client: '', note: '', work: '' }; }
  private message(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse ? error.error?.error || fallback : fallback;
  }
  private notice(message: string): void { this.snackBar.open(message, 'OK', { duration: 4200 }); }
  private updateTitle(): void {
    document.title = this.activeTask ? `● ${this.formatDuration(this.taskNet(this.activeTask))} | ${this.activeTask.name}` : this.originalTitle;
  }
}
