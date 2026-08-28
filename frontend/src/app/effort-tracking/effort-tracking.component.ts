import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EffortProject, EffortService, EffortTask } from '../services/effort.service';
import { RichTextEditorComponent } from '../shared/rich-text-editor/rich-text-editor.component';
import { AuthService } from '../services/auth.service';
import { WorkBoardService, WorkOption } from '../services/work-board.service';

type ProjectForm = {
  name: string;
  customer: string;
  comment: string;
  workItemId: string;
};

type TaskForm = {
  name: string;
  note: string;
  subWorkItemId: string;
};

type TaskAction = 'start' | 'stop' | 'close';

@Component({
  selector: 'app-effort-tracking',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
    RichTextEditorComponent
  ],
  templateUrl: './effort-tracking.component.html',
  styleUrl: './effort-tracking.component.scss'
})
export class EffortTrackingComponent implements OnInit, OnDestroy {
  projects: EffortProject[] = [];
  workOptions: WorkOption[] = [];
  selectedProject: EffortProject | null = null;
  loading = true;
  saving = false;
  showProjectForm = false;
  showTaskForm = false;
  editingProject = false;
  editingTaskId: string | null = null;
  projectForm: ProjectForm = this.emptyProjectForm();
  taskForm: TaskForm = this.emptyTaskForm();
  now = Date.now();
  expandedTaskNotes = new Set<string>();
  taskAction: { taskId: string; action: TaskAction } | null = null;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private readonly originalTitle = document.title || 'EPDS Admin';

  constructor(
    private effortService: EffortService,
    private snackBar: MatSnackBar,
    public auth: AuthService,
    private workBoard: WorkBoardService
  ) {}

  ngOnInit(): void {
    this.loadProjects();
    this.loadWorkOptions();
    this.tickId = setInterval(() => {
      this.now = Date.now();
      this.updateDocumentTitle();
    }, 1000);
  }

  async loadWorkOptions(): Promise<void> {
    try { this.workOptions = await firstValueFrom(this.workBoard.listActiveOptions()); }
    catch { this.workOptions = []; }
  }

  ngOnDestroy(): void {
    if (this.tickId) clearInterval(this.tickId);
    document.title = this.originalTitle;
  }

  async loadProjects(selectId?: string): Promise<void> {
    this.loading = true;
    try {
      this.projects = (await firstValueFrom(this.effortService.listProjects())).map((project) => this.stampProjectDisplayBase(project));
      const selectedId = selectId || this.selectedProject?.id || this.projects[0]?.id;
      this.selectedProject = selectedId ? this.projects.find((project) => project.id === selectedId) || null : null;
      if (this.selectedProject) await this.selectProject(this.selectedProject, false);
      this.updateDocumentTitle();
    } catch {
      this.snackBar.open('Effort projects could not be loaded.', 'OK', { duration: 3500 });
    } finally {
      this.loading = false;
    }
  }

  async selectProject(project: EffortProject, setLoading = true): Promise<void> {
    if (setLoading) this.loading = true;
    try {
      this.selectedProject = this.stampProjectDisplayBase(await firstValueFrom(this.effortService.getProject(project.id)));
      this.upsertProject(this.selectedProject);
      this.cancelTaskForm();
      this.cancelProjectForm();
      this.updateDocumentTitle();
    } catch {
      this.snackBar.open('Project details could not be loaded.', 'OK', { duration: 3500 });
    } finally {
      if (setLoading) this.loading = false;
    }
  }

  startCreateProject(): void {
    this.projectForm = this.emptyProjectForm();
    this.editingProject = false;
    this.showProjectForm = true;
  }

  startEditProject(): void {
    if (!this.selectedProject) return;
    this.projectForm = {
      name: this.selectedProject.name,
      customer: this.selectedProject.customer || '',
      comment: this.selectedProject.comment || ''
      ,workItemId: this.selectedProject.workItemId || ''
    };
    this.editingProject = true;
    this.showProjectForm = true;
  }

  cancelProjectForm(): void {
    this.showProjectForm = false;
    this.editingProject = false;
    this.projectForm = this.emptyProjectForm();
  }

  async saveProject(): Promise<void> {
    const payload = {
      name: this.projectForm.name.trim(),
      customer: this.projectForm.customer.trim(),
      comment: this.projectForm.comment.trim()
      ,workItemId: this.projectForm.workItemId || null
    };
    if (!payload.name) {
      this.snackBar.open('Project name is required.', 'OK', { duration: 3000 });
      return;
    }

    this.saving = true;
    try {
      const saved = this.stampProjectDisplayBase(this.editingProject && this.selectedProject
        ? await firstValueFrom(this.effortService.updateProject(this.selectedProject.id, payload))
        : await firstValueFrom(this.effortService.createProject(payload)));
      this.upsertProject(saved);
      this.selectedProject = saved;
      this.cancelProjectForm();
      this.updateDocumentTitle();
    } catch {
      this.snackBar.open('Project could not be saved.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  startCreateTask(): void {
    this.taskForm = this.emptyTaskForm();
    this.editingTaskId = null;
    this.showTaskForm = true;
  }

  startEditTask(task: EffortTask): void {
    this.taskForm = {
      name: task.name,
      note: task.note || ''
      ,subWorkItemId: task.subWorkItemId || ''
    };
    this.editingTaskId = task.id;
    this.showTaskForm = true;
  }

  cancelTaskForm(): void {
    this.showTaskForm = false;
    this.editingTaskId = null;
    this.taskForm = this.emptyTaskForm();
  }

  async saveTask(): Promise<void> {
    if (!this.selectedProject) return;
    const payload = {
      name: this.taskForm.name.trim(),
      note: this.taskForm.note.trim()
      ,subWorkItemId: this.taskForm.subWorkItemId || null
    };
    if (!payload.name) {
      this.snackBar.open('Task name is required.', 'OK', { duration: 3000 });
      return;
    }

    this.saving = true;
    try {
      if (this.editingTaskId) {
        await firstValueFrom(this.effortService.updateTask(this.editingTaskId, payload));
      } else {
        await firstValueFrom(this.effortService.createTask(this.selectedProject.id, payload));
      }
      await this.refreshSelected();
      this.cancelTaskForm();
    } catch {
      this.snackBar.open('Task could not be saved.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  async startTask(task: EffortTask): Promise<void> {
    if (this.saving) return;
    const runningTask = this.activeTask();
    const previousSnapshot = this.snapshotSelectedProject();
    if (runningTask && runningTask.id !== task.id) {
      const confirmed = window.confirm(
        `You already have a running task:\n\n${runningTask.name}\n\nStarting "${task.name}" will stop the running timer and start this task. Continue?`
      );
      if (!confirmed) return;
    }

    this.saving = true;
    this.taskAction = { taskId: task.id, action: 'start' };
    if (runningTask && runningTask.id !== task.id) this.stopTaskTimerOnScreen(runningTask);
    try {
      await firstValueFrom(this.effortService.startTask(task.id));
      await this.refreshSelected();
    } catch {
      this.restoreSelectedProject(previousSnapshot);
      this.snackBar.open('Timer could not be started.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
      this.taskAction = null;
    }
  }

  async stopTask(task: EffortTask): Promise<void> {
    if (this.saving) return;
    const previousSnapshot = this.snapshotSelectedProject();
    this.saving = true;
    this.taskAction = { taskId: task.id, action: 'stop' };
    this.stopTaskTimerOnScreen(task);
    try {
      await firstValueFrom(this.effortService.stopTask(task.id));
      await this.refreshSelected();
    } catch {
      this.restoreSelectedProject(previousSnapshot);
      this.snackBar.open('Timer could not be stopped.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
      this.taskAction = null;
    }
  }

  async closeTask(task: EffortTask): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.taskAction = { taskId: task.id, action: 'close' };
    try {
      await firstValueFrom(this.effortService.closeTask(task.id));
      await this.refreshSelected();
    } catch {
      this.snackBar.open('Task could not be closed.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
      this.taskAction = null;
    }
  }

  async closeProject(): Promise<void> {
    if (!this.selectedProject) return;
    this.saving = true;
    try {
      const closed = this.stampProjectDisplayBase(await firstValueFrom(this.effortService.closeProject(this.selectedProject.id)));
      this.upsertProject(closed);
      this.selectedProject = closed;
      this.updateDocumentTitle();
    } catch {
      this.snackBar.open('Project could not be closed.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  async reopenProject(): Promise<void> {
    if (!this.selectedProject) return;
    this.saving = true;
    try {
      const reopened = this.stampProjectDisplayBase(await firstValueFrom(this.effortService.reopenProject(this.selectedProject.id)));
      this.upsertProject(reopened);
      this.selectedProject = reopened;
      this.updateDocumentTitle();
    } catch {
      this.snackBar.open('Project could not be reopened.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  taskDisplayNet(task: EffortTask): number {
    if (!task.active || !task.activeStartedAt) return task.netMs || 0;
    return (task.netMs || 0) + Math.max(0, this.now - (task.displayBaseAt || this.now));
  }

  projectDisplayNet(project: EffortProject | null = this.selectedProject): number {
    if (!project) return 0;
    if (project.status === 'closed') return project.closedNetMs || project.netMs || 0;
    return (project.tasks || []).reduce((total, task) => total + this.taskDisplayNet(task), 0);
  }

  grossText(item: EffortProject | EffortTask): string {
    if (item.status !== 'closed') return '-';
    return this.formatDuration(item.closedGrossMs || item.grossMs || 0);
  }

  formatDuration(valueMs: number): string {
    const totalSeconds = Math.max(0, Math.floor((valueMs || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  statusText(status: string): string {
    return status === 'closed' ? 'Closed' : 'Open';
  }

  taskStatusText(task: EffortTask): string {
    if (task.active) return 'Running';
    if (task.status === 'closed') return 'Closed';
    if (!task.hasStarted) return 'New';
    return 'Open';
  }

  startButtonText(task: EffortTask): string {
    const runningTask = this.activeTask();
    return runningTask && runningTask.id !== task.id ? 'Switch' : 'Start';
  }

  startButtonTooltip(task: EffortTask): string {
    const runningTask = this.activeTask();
    return runningTask && runningTask.id !== task.id
      ? `Stops "${runningTask.name}" and starts this task after confirmation.`
      : 'Start timer';
  }

  isTaskActionRunning(task: EffortTask, action: TaskAction): boolean {
    return this.taskAction?.taskId === task.id && this.taskAction.action === action;
  }

  isTaskNoteExpanded(task: EffortTask): boolean {
    return this.expandedTaskNotes.has(task.id);
  }

  toggleTaskNote(task: EffortTask): void {
    if (this.expandedTaskNotes.has(task.id)) this.expandedTaskNotes.delete(task.id);
    else this.expandedTaskNotes.add(task.id);
  }

  shouldShowTaskNoteToggle(task: EffortTask): boolean {
    const text = this.plainText(task.note || '');
    return text.length > 260 || (text.match(/\n/g) || []).length >= 6;
  }

  private async refreshSelected(): Promise<void> {
    if (!this.selectedProject) return;
    const project = this.stampProjectDisplayBase(await firstValueFrom(this.effortService.getProject(this.selectedProject.id)));
    this.selectedProject = project;
    this.upsertProject(project);
    this.updateDocumentTitle();
  }

  private stopTaskTimerOnScreen(task: EffortTask): void {
    const displayNet = this.taskDisplayNet(task);
    task.netMs = displayNet;
    task.active = false;
    task.activeByCurrentUser = false;
    task.activeStartedAt = null;
    task.displayBaseAt = undefined;
    this.now = Date.now();
    this.updateDocumentTitle();
  }

  private snapshotSelectedProject(): EffortProject | null {
    return this.selectedProject ? structuredClone(this.selectedProject) : null;
  }

  private restoreSelectedProject(snapshot: EffortProject | null): void {
    if (!snapshot) return;
    this.selectedProject = snapshot;
    this.upsertProject(snapshot);
    this.updateDocumentTitle();
  }

  private stampProjectDisplayBase(project: EffortProject): EffortProject {
    const displayBaseAt = Date.now();
    return {
      ...project,
      tasks: (project.tasks || []).map((task) => ({
        ...task,
        displayBaseAt: task.activeByCurrentUser ? displayBaseAt : undefined
      }))
    };
  }

  private upsertProject(project: EffortProject): void {
    const index = this.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) this.projects[index] = project;
    else this.projects.unshift(project);
    this.projects = [...this.projects].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.updatedAt.localeCompare(a.updatedAt));
  }

  private activeTask(): EffortTask | null {
    for (const project of this.projects) {
      const task = (project.tasks || []).find((item) => item.activeByCurrentUser);
      if (task) return task;
    }
    return null;
  }

  private updateDocumentTitle(): void {
    const task = this.activeTask();
    document.title = task ? `🔴 REC ${this.formatDuration(this.taskDisplayNet(task))} | ${task.name}` : this.originalTitle;
  }

  private plainText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  private emptyProjectForm(): ProjectForm {
    return { name: '', customer: '', comment: '', workItemId: '' };
  }

  private emptyTaskForm(): TaskForm {
    return { name: '', note: '', subWorkItemId: '' };
  }

  selectedWorkOption(): WorkOption | null {
    return this.workOptions.find((work) => work.id === this.projectForm.workItemId) || null;
  }

  projectWorkChanged(): void {
    const work = this.selectedWorkOption();
    if (!work || this.editingProject) return;
    this.projectForm.name = work.name;
    this.projectForm.customer = work.customer || '';
  }

  availableSubWorks(): WorkOption['subWorks'] {
    const workId = this.selectedProject?.workItemId || '';
    return this.workOptions.find((work) => work.id === workId)?.subWorks || [];
  }
}
