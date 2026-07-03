import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EffortProject, EffortService, EffortTask } from '../services/effort.service';

type ProjectForm = {
  name: string;
  customer: string;
  comment: string;
};

type TaskForm = {
  name: string;
  note: string;
};

@Component({
  selector: 'app-effort-tracking',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule
  ],
  templateUrl: './effort-tracking.component.html',
  styleUrl: './effort-tracking.component.scss'
})
export class EffortTrackingComponent implements OnInit, OnDestroy {
  projects: EffortProject[] = [];
  selectedProject: EffortProject | null = null;
  loading = true;
  saving = false;
  showProjectForm = false;
  showTaskForm = false;
  editingProject = false;
  projectForm: ProjectForm = this.emptyProjectForm();
  taskForm: TaskForm = this.emptyTaskForm();
  now = Date.now();
  private tickId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private effortService: EffortService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadProjects();
    this.tickId = setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.tickId) clearInterval(this.tickId);
  }

  async loadProjects(selectId?: string): Promise<void> {
    this.loading = true;
    try {
      this.projects = await firstValueFrom(this.effortService.listProjects());
      const selectedId = selectId || this.selectedProject?.id || this.projects[0]?.id;
      this.selectedProject = selectedId ? this.projects.find((project) => project.id === selectedId) || null : null;
      if (this.selectedProject) await this.selectProject(this.selectedProject, false);
    } catch {
      this.snackBar.open('Effort projects could not be loaded.', 'OK', { duration: 3500 });
    } finally {
      this.loading = false;
    }
  }

  async selectProject(project: EffortProject, setLoading = true): Promise<void> {
    if (setLoading) this.loading = true;
    try {
      this.selectedProject = await firstValueFrom(this.effortService.getProject(project.id));
      this.upsertProject(this.selectedProject);
      this.cancelTaskForm();
      this.cancelProjectForm();
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
    };
    if (!payload.name) {
      this.snackBar.open('Project name is required.', 'OK', { duration: 3000 });
      return;
    }

    this.saving = true;
    try {
      const saved = this.editingProject && this.selectedProject
        ? await firstValueFrom(this.effortService.updateProject(this.selectedProject.id, payload))
        : await firstValueFrom(this.effortService.createProject(payload));
      this.upsertProject(saved);
      this.selectedProject = saved;
      this.cancelProjectForm();
    } catch {
      this.snackBar.open('Project could not be saved.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  startCreateTask(): void {
    this.taskForm = this.emptyTaskForm();
    this.showTaskForm = true;
  }

  cancelTaskForm(): void {
    this.showTaskForm = false;
    this.taskForm = this.emptyTaskForm();
  }

  async saveTask(): Promise<void> {
    if (!this.selectedProject) return;
    const payload = {
      name: this.taskForm.name.trim(),
      note: this.taskForm.note.trim()
    };
    if (!payload.name) {
      this.snackBar.open('Task name is required.', 'OK', { duration: 3000 });
      return;
    }

    this.saving = true;
    try {
      await firstValueFrom(this.effortService.createTask(this.selectedProject.id, payload));
      await this.refreshSelected();
      this.cancelTaskForm();
    } catch {
      this.snackBar.open('Task could not be saved.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  async startTask(task: EffortTask): Promise<void> {
    this.saving = true;
    try {
      await firstValueFrom(this.effortService.startTask(task.id));
      await this.refreshSelected();
    } catch {
      this.snackBar.open('Timer could not be started.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  async stopTask(task: EffortTask): Promise<void> {
    this.saving = true;
    try {
      await firstValueFrom(this.effortService.stopTask(task.id));
      await this.refreshSelected();
    } catch {
      this.snackBar.open('Timer could not be stopped.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  async closeTask(task: EffortTask): Promise<void> {
    this.saving = true;
    try {
      await firstValueFrom(this.effortService.closeTask(task.id));
      await this.refreshSelected();
    } catch {
      this.snackBar.open('Task could not be closed.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  async closeProject(): Promise<void> {
    if (!this.selectedProject) return;
    this.saving = true;
    try {
      const closed = await firstValueFrom(this.effortService.closeProject(this.selectedProject.id));
      this.upsertProject(closed);
      this.selectedProject = closed;
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
      const reopened = await firstValueFrom(this.effortService.reopenProject(this.selectedProject.id));
      this.upsertProject(reopened);
      this.selectedProject = reopened;
    } catch {
      this.snackBar.open('Project could not be reopened.', 'OK', { duration: 3500 });
    } finally {
      this.saving = false;
    }
  }

  taskDisplayNet(task: EffortTask): number {
    if (!task.active || !task.activeStartedAt) return task.netMs || 0;
    return (task.netMs || 0) + Math.max(0, this.now - new Date(task.activeStartedAt).getTime());
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

  private async refreshSelected(): Promise<void> {
    if (!this.selectedProject) return;
    const project = await firstValueFrom(this.effortService.getProject(this.selectedProject.id));
    this.selectedProject = project;
    this.upsertProject(project);
  }

  private upsertProject(project: EffortProject): void {
    const index = this.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) this.projects[index] = project;
    else this.projects.unshift(project);
    this.projects = [...this.projects].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.updatedAt.localeCompare(a.updatedAt));
  }

  private emptyProjectForm(): ProjectForm {
    return { name: '', customer: '', comment: '' };
  }

  private emptyTaskForm(): TaskForm {
    return { name: '', note: '' };
  }
}
