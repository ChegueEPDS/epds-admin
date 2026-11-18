import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { EMPTY, expand, filter, firstValueFrom, map, switchMap, takeWhile, tap, timer } from 'rxjs';
import { WorkBoardService, WorkImportJob } from '../services/work-board.service';

const finished = (job: WorkImportJob) => ['succeeded', 'rejected', 'failed'].includes(job.state);
const labels: Record<WorkImportJob['state'], string> = {
  reading: 'Reading the workbook…',
  validating: 'Validating work rows…',
  saving: 'Saving all changes…',
  succeeded: 'Import completed',
  rejected: 'Import rejected',
  failed: 'Import failed'
};

@Component({
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title id="work-transfer-title">Import / Export works</h2>
    <mat-dialog-content class="content">
      <div class="actions">
        <button mat-stroked-button type="button" (click)="export('template')" [disabled]="!!downloadPending">
          <mat-icon class="material-symbols-outlined">download</mat-icon>Download template
        </button>
        <button mat-stroked-button type="button" (click)="export('export')" [disabled]="!!downloadPending">
          <mat-icon class="material-symbols-outlined">download</mat-icon>Export works
        </button>
      </div>
      <p>Keep the ID in column A to update an exported work. Leave it blank to create a new work.</p>
      <div class="files">
        <label>Excel workbook <input type="file" accept=".xlsx" (change)="selectFile($event, 'workbook')" [disabled]="busy"></label>
        <label>Attachments ZIP (optional) <input type="file" accept=".zip" (change)="selectFile($event, 'archive')" [disabled]="busy"></label>
      </div>
      @if (busy) {
        <div class="status" role="status">
          <span>{{ statusText }}</span>
          @if (job?.state === 'validating' && job?.total) { <span>{{ job?.processed }} / {{ job?.total }} rows</span> }
        </div>
        <mat-progress-bar aria-label="Import progress" [mode]="percent === undefined ? 'indeterminate' : 'determinate'" [value]="percent ?? 0"/>
      }
      @if (job?.state === 'rejected') {
        <div class="result error" role="alert">
          <strong>Import rejected. No works were saved.</strong>
          <span>{{ job?.errors }} validation messages. Correct the highlighted cells and upload again.</span>
          <button mat-stroked-button type="button" (click)="downloadErrors()" [disabled]="!!downloadPending || !job?.canDownload">
            <mat-icon class="material-symbols-outlined">download</mat-icon>Download error workbook
          </button>
        </div>
      }
      @if (job?.state === 'succeeded') {
        <p role="status" class="result">{{ job?.created }} created · {{ job?.updated }} updated · {{ job?.unchanged }} unchanged</p>
      }
      @if (error) { <p class="error" role="alert">{{ error }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="saved" [disabled]="busy">Close</button>
      @if (job && !busy && job.state !== 'succeeded' && job.state !== 'rejected' && job.state !== 'failed') {
        <button mat-flat-button color="primary" type="button" (click)="resume()">Check progress</button>
      } @else {
        <button mat-flat-button color="primary" type="button" (click)="start()" [disabled]="!workbook || busy">Import workbook</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .content, .files, .result { display: grid; gap: 12px; }
    .actions, .status { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .status { justify-content: space-between; }
    .files label { display: grid; gap: 6px; min-width: 0; }
    input { max-width: 100%; }
    p { margin: 0; }
    .result { padding: 12px; border: 1px solid var(--brand-border); border-radius: 8px; }
    .result button { justify-self: start; }
    .error { color: var(--brand-error); }
  `]
})
export class WorkTransferDialogComponent {
  private readonly board = inject(WorkBoardService);
  private readonly dialog = inject(MatDialogRef<WorkTransferDialogComponent, boolean>);
  private readonly destroy = inject(DestroyRef);
  workbook?: File;
  archive?: File;
  job?: WorkImportJob;
  busy = false;
  saved = false;
  error = '';
  uploadPercent?: number;
  downloadPending = '';

  get statusText(): string { return this.job ? labels[this.job.state] : 'Uploading workbook…'; }
  get percent(): number | undefined {
    if (!this.job) return this.uploadPercent;
    return this.job.state === 'validating' && this.job.total ? this.job.processed * 100 / this.job.total : undefined;
  }

  selectFile(event: Event, kind: 'workbook' | 'archive'): void {
    this[kind] = (event.target as HTMLInputElement).files?.[0];
    this.error = '';
  }

  start(): void {
    if (!this.workbook || this.busy) return;
    this.job = undefined;
    this.uploadPercent = undefined;
    const request = this.board.startWorkImport(this.workbook, this.archive).pipe(
      tap((event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) this.uploadPercent = event.loaded * 100 / event.total;
      }),
      filter((event) => event.type === HttpEventType.Response),
      map((event) => event.body!)
    );
    this.track(request);
  }

  resume(): void {
    if (this.job && !this.busy) this.track(this.board.workImportStatus(this.job.id));
  }

  private track(request: ReturnType<WorkBoardService['workImportStatus']>): void {
    this.busy = this.dialog.disableClose = true;
    this.error = '';
    request.pipe(
      expand((job) => finished(job) ? EMPTY : timer(600).pipe(switchMap(() => this.board.workImportStatus(job.id)))),
      takeWhile((job) => !finished(job), true),
      takeUntilDestroyed(this.destroy)
    ).subscribe({
      next: (job) => {
        this.job = job;
        if (job.state === 'succeeded') {
          this.saved = true;
          this.board.refreshDashboard();
        }
        if (job.state === 'failed') this.error = job.message || 'Import failed.';
      },
      error: (error) => {
        this.error = error?.error?.error || (this.job ? 'Progress could not be retrieved. Check progress to resume.' : 'The workbook could not be uploaded.');
        this.busy = this.dialog.disableClose = false;
      },
      complete: () => { this.busy = this.dialog.disableClose = false; }
    });
  }

  export(kind: 'template' | 'export'): void {
    void this.download(kind, this.board.downloadWorkTransfer(kind), 'project-tracker-' + kind + '.xlsx');
  }

  downloadErrors(): void {
    if (this.job) void this.download('errors', this.board.downloadWorkImportErrors(this.job.id), 'project-tracker-import-errors.xlsx');
  }

  private async download(kind: string, request: ReturnType<WorkBoardService['downloadWorkTransfer']>, name: string): Promise<void> {
    if (this.downloadPending) return;
    this.downloadPending = kind;
    try {
      const file = await firstValueFrom(request);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.error = 'The Excel file could not be downloaded.';
    } finally {
      this.downloadPending = '';
    }
  }
}
