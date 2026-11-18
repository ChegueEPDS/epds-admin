import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { EMPTY, expand, filter, firstValueFrom, map, switchMap, takeWhile, tap, timer } from 'rxjs';
import { WorkBoardService, WorkImportJob, WorkbookTransferTarget } from '../services/work-board.service';

const finished = (job: WorkImportJob) => ['succeeded', 'rejected', 'failed'].includes(job.state);
type ImportFileKind = 'workbook' | 'archive';
const labels: Record<WorkImportJob['state'], string> = {
  reading: 'Reading the workbook…',
  validating: 'Validating rows…',
  saving: 'Saving all changes…',
  succeeded: 'Import completed',
  rejected: 'Import rejected',
  failed: 'Import failed'
};

@Component({
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title id="work-transfer-title">Import / Export {{ target }}</h2>
    <mat-dialog-content class="content">
      <section class="drop-zone" [class.dragging]="dragDepth > 0 && !busy" aria-label="Import files"
        (dragenter)="onDragEnter($event)" (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">
        <mat-icon class="material-symbols-outlined upload-icon" aria-hidden="true">upload_file</mat-icon>
        <h3>Drop files here</h3>
        <input #filePicker type="file" [accept]="isClients ? '.xlsx' : '.xlsx,.zip'" [multiple]="!isClients" hidden [disabled]="busy" (change)="selectFiles(filePicker)">
        <button mat-stroked-button type="button" class="browse" (click)="filePicker.click()"
          [disabled]="busy" aria-describedby="work-transfer-file-types">
          Browse files
        </button>
        <p id="work-transfer-file-types" class="muted">Excel workbook (.xlsx)@if (!isClients) { <span> · Optional attachments (.zip)</span> }</p>
      </section>
      @if (workbook || archive) {
        <ul class="selected-files" aria-label="Selected files">
          @for (entry of fileKinds; track entry.kind) {
            @if (this[entry.kind]; as file) {
              <li>
                <mat-icon class="material-symbols-outlined" aria-hidden="true">{{ entry.icon }}</mat-icon>
                <div class="file-description">
                  <strong [title]="file.name">{{ file.name }}</strong>
                  <span class="muted">{{ entry.label }}</span>
                </div>
                <button mat-icon-button type="button" [attr.aria-label]="'Remove ' + entry.label"
                  [disabled]="busy" (click)="removeFile(entry.kind)">
                  <mat-icon class="material-symbols-outlined" aria-hidden="true">close</mat-icon>
                </button>
              </li>
            }
          }
        </ul>
      }
      <div class="actions">
        <button mat-button type="button" (click)="export('template')" [disabled]="!!downloadPending">
          <mat-icon class="material-symbols-outlined">download</mat-icon>Download template
        </button>
        <button mat-button type="button" (click)="export('export')" [disabled]="!!downloadPending">
          <mat-icon class="material-symbols-outlined">download</mat-icon>Export {{ target }}
        </button>
      </div>
      <p class="muted import-hint">
        Keep the ID in column A to update the exported {{ singular }}. Leave it blank to create a new {{ singular }}.
      </p>
      @if (busy) {
        <div class="status" role="status">
          <span>{{ statusText }}</span>
          @if (job?.state === 'validating' && job?.total) { <span>{{ job?.processed }} / {{ job?.total }} rows</span> }
        </div>
        <mat-progress-bar aria-label="Import progress" [mode]="percent === undefined ? 'indeterminate' : 'determinate'" [value]="percent ?? 0"/>
      }
      @if (job?.state === 'rejected') {
        <div class="result error" role="alert">
          <strong>Import rejected. No {{ target }} were saved.</strong>
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
    .content, .result { display: grid; gap: 12px; }
    .actions, .status { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
    .status { justify-content: space-between; }
    .drop-zone {
      display: grid;
      justify-items: center;
      gap: 12px;
      padding: clamp(20px, 5vw, 32px) 16px;
      border: 2px dashed var(--brand-border-strong);
      border-radius: 14px;
      background: var(--brand-panel-soft);
      color: var(--brand-ink);
      text-align: center;
    }
    .drop-zone.dragging { border-color: var(--brand-accent-ink); background: var(--brand-accent-soft); }
    .upload-icon { width: 40px; height: 40px; font-size: 40px; }
    .drop-zone h3 { font-size: 1.05rem; font-weight: 700; }
    .browse { min-height: 40px; }
    .muted { color: var(--brand-muted); font-size: .875rem; }
    .import-hint { line-height: 1.5; }
    p, h3 { margin: 0; }
    .selected-files { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
    .selected-files li {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 4px 8px 4px 12px;
      border: 1px solid var(--brand-border);
      border-radius: 10px;
    }
    .file-description { display: grid; gap: 2px; }
    .file-description strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result { padding: 12px; border: 1px solid var(--brand-border); border-radius: 8px; }
    .result button { justify-self: start; }
    .error { color: var(--brand-error); }
  `]
})
export class WorkTransferDialogComponent {
  private readonly board = inject(WorkBoardService);
  readonly target = inject<WorkbookTransferTarget>(MAT_DIALOG_DATA);
  readonly isClients = this.target === 'clients';
  readonly singular = this.isClients ? 'client' : 'work';
  private readonly filenamePrefix = this.isClients ? 'project-tracker-clients' : 'project-tracker';
  private readonly dialog = inject(MatDialogRef<WorkTransferDialogComponent, boolean>);
  private readonly destroy = inject(DestroyRef);
  workbook?: File;
  archive?: File;
  readonly fileKinds = [
    { kind: 'workbook', label: 'Excel workbook', icon: 'table_view' },
    { kind: 'archive', label: 'Attachments ZIP', icon: 'folder_zip' }
  ] as const;
  dragDepth = 0;
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

  selectFiles(input: HTMLInputElement): void {
    if (input.files) this.setFiles(input.files);
    input.value = '';
  }

  onDragEnter(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (!this.busy) this.dragDepth++;
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = this.busy ? 'none' : 'copy';
  }

  onDragLeave(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) this.dragDepth = Math.max(0, this.dragDepth - 1);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    if (event.dataTransfer) this.setFiles(event.dataTransfer.files);
  }

  removeFile(kind: ImportFileKind): void {
    if (this.busy) return;
    this[kind] = undefined;
    this.error = '';
  }

  private setFiles(files: FileList): void {
    if (this.busy || !files.length) return;
    const picked: Partial<Record<ImportFileKind, File>> = {};
    for (const file of Array.from(files)) {
      const kind = /\.xlsx$/i.test(file.name) ? 'workbook' : !this.isClients && /\.zip$/i.test(file.name) ? 'archive' : undefined;
      if (!kind || picked[kind]) {
        this.error = this.isClients ? 'Choose one .xlsx workbook.' : 'Choose one .xlsx workbook and up to one .zip archive.';
        return;
      }
      picked[kind] = file;
    }
    Object.assign(this, picked);
    this.error = '';
  }

  start(): void {
    if (!this.workbook || this.busy) return;
    this.dragDepth = 0;
    this.job = undefined;
    this.uploadPercent = undefined;
    const request = this.board.startWorkImport(this.target, this.workbook, this.archive).pipe(
      tap((event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) this.uploadPercent = event.loaded * 100 / event.total;
      }),
      filter((event) => event.type === HttpEventType.Response),
      map((event) => event.body!)
    );
    this.track(request);
  }

  resume(): void {
    if (this.job && !this.busy) this.track(this.board.workImportStatus(this.job.id, this.target));
  }

  private track(request: ReturnType<WorkBoardService['workImportStatus']>): void {
    this.busy = this.dialog.disableClose = true;
    this.error = '';
    request.pipe(
      expand((job) => finished(job) ? EMPTY : timer(600).pipe(switchMap(() => this.board.workImportStatus(job.id, this.target)))),
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
    void this.download(kind, this.board.downloadWorkTransfer(kind, this.target), this.filenamePrefix + '-' + kind + '.xlsx');
  }

  downloadErrors(): void {
    if (this.job) void this.download('errors', this.board.downloadWorkImportErrors(this.job.id, this.target), this.filenamePrefix + '-import-errors.xlsx');
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
