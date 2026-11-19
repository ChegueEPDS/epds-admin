import { UiTextPipe } from '../i18n/ui-text.pipe';
import { Component, Input, OnChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { EffortProject, EffortService, EffortTask } from '../services/effort.service';
import { WorkItem } from '../services/work-board.service';

@Component({
  selector: 'app-work-next-actions',
  imports: [UiTextPipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h4>{{ 'Next actions' | uiText }}</h4>
    @if (loading) { <p>{{ 'Loading tasks…' | uiText }}</p> }
    @if (error) { <p role="alert">{{ error }}</p> }
    @for (task of tasks; track task.id) {
      <div class="task-row">
        <div>
          <strong>{{ task.name }}</strong>
          @if (task.subWorkItem; as sub) { <div>{{ sub.subWorkNumber }} · {{ sub.name }}</div> }
          @if (task.dueDate) { <div>{{ 'Due {0}' | uiText: (task.dueDate) }}</div> }
          @if (task.status === 'closed') { <div>{{ 'Completed' | uiText }}</div> }
        </div>
        @if (editable && !work.archivedAt && canEditTask(task)) {
          <button mat-button type="button" (click)="start(task)" [disabled]="saving">{{ 'Edit' | uiText }}</button>
        }
      </div>
    } @empty {
      @if (!loading && !error && !work.reporting?.nextAction) { <p>{{ 'No next actions.' | uiText }}</p> }
    }
    @if (editable && !work.archivedAt && !loading) {
      @if (editing) {
        <form class="action-form" (ngSubmit)="save()">
          <mat-form-field appearance="outline">
            <mat-label>{{ 'Next action' | uiText }}</mat-label>
            <input matInput name="actionName" [(ngModel)]="name" required maxlength="200">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ 'Due date' | uiText }}</mat-label>
            <input matInput type="date" name="actionDueDate" [(ngModel)]="dueDate">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ 'Sub-work' | uiText }}</mat-label>
            <mat-select name="actionSubWork" [(ngModel)]="subWorkId">
              <mat-option value="">{{ 'Entire work' | uiText }}</mat-option>
              @if (editingTask?.subWorkItemId && !hasSubWork(editingTask?.subWorkItemId)) {
                <mat-option [value]="editingTask?.subWorkItemId">{{ editingTask?.subWorkItem?.name }}</mat-option>
              }
              @for (sub of work.subWorks; track sub.id) {
                <mat-option [value]="sub.id">{{ sub.subWorkNumber }} · {{ sub.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <div class="actions">
            <button mat-button type="button" (click)="editing = false" [disabled]="saving">{{ 'Cancel' | uiText }}</button>
            <button mat-flat-button type="submit" [disabled]="saving || !name.trim()">{{ 'Save action' | uiText }}</button>
          </div>
        </form>
      } @else {
        <button mat-stroked-button type="button" (click)="start()">{{ 'Add next action' | uiText }}</button>
      }
    }
  `,
  styles: [`
    :host { display: block; margin-top: 1rem; }
    h4 { margin: 0 0 .75rem; }
    .task-row { display: flex; justify-content: space-between; align-items: center; gap: .75rem;
      padding: .65rem 0; border-top: 1px solid var(--mat-sys-outline-variant); }
    .action-form { display: grid; gap: .5rem; margin-top: .75rem; }
    .actions { display: flex; gap: .5rem; justify-content: flex-end; }
  `]
})
export class WorkNextActionsComponent implements OnChanges {
  @Input({ required: true }) work!: WorkItem;
  @Input() editable = false;
  projects: EffortProject[] = [];
  loading = false;
  saving = false;
  error = '';
  editing = false;
  editingTask?: EffortTask;
  name = '';
  dueDate = '';
  subWorkId = '';
  private workId = '';

  constructor(private effort: EffortService) {}

  get tasks(): EffortTask[] {
    return this.projects.flatMap(project => project.tasks).sort((a, b) =>
      Number(a.status === 'closed') - Number(b.status === 'closed') ||
      (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  }

  ngOnChanges(): void {
    if (this.work.id === this.workId) return;
    this.workId = this.work.id;
    this.projects = [];
    this.editing = false;
    this.saving = false;
    void this.load(this.workId);
  }

  canEditTask(task: EffortTask): boolean {
    return this.projects.some(project => project.id === task.projectId && project.status === 'open');
  }

  hasSubWork(id?: string | null): boolean { return this.work.subWorks.some(sub => sub.id === id); }

  start(task?: EffortTask): void {
    this.error = '';
    this.editing = true;
    this.editingTask = task;
    this.name = task?.name || '';
    this.dueDate = task?.dueDate || '';
    this.subWorkId = task?.subWorkItemId || '';
  }

  async save(): Promise<void> {
    if (!this.editable || this.saving || !this.name.trim()) return;
    const work = this.work;
    const task = this.editingTask;
    const payload = { name: this.name.trim(), dueDate: this.dueDate || null, subWorkItemId: this.subWorkId || null };
    this.saving = true;
    this.error = '';
    try {
      if (task) {
        await firstValueFrom(this.effort.updateTask(task.id, payload));
      } else {
        const project = this.projects.find(item => item.shared) ||
          await firstValueFrom(this.effort.createProject({ name: work.name, workItemId: work.id, shared: true }));
        if (this.workId !== work.id) return;
        await firstValueFrom(this.effort.createTask(project.id, payload));
      }
      if (this.workId === work.id) {
        this.editing = false;
        await this.load(work.id);
      }
    } catch (error: any) {
      if (this.workId === work.id) this.error = error?.error?.error || 'The action could not be saved.';
    } finally {
      if (this.workId === work.id) this.saving = false;
    }
  }

  private async load(id: string): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const projects = await firstValueFrom(this.effort.listProjects(true, id));
      if (this.workId === id) this.projects = projects;
    } catch (error: any) {
      if (this.workId === id) this.error = error?.error?.error || 'Tasks could not be loaded.';
    } finally {
      if (this.workId === id) this.loading = false;
    }
  }
}
