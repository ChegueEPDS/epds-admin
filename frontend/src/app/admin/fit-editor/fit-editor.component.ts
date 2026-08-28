import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { FitAnalysis, FitFileService, FitLap, FitMetrics } from '../../services/fit-file.service';

@Component({
  selector: 'app-fit-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, DecimalPipe, MatButtonModule, MatCardModule,
    MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTableModule, MatTabsModule
  ],
  templateUrl: './fit-editor.component.html',
  styleUrl: './fit-editor.component.scss'
})
export class FitEditorComponent {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  analysis: FitAnalysis | null = null;
  sourceAnalysis: FitAnalysis | null = null;
  selectedFile: File | null = null;
  selectedPauses = new Set<string>();
  appliedPauses = new Set<string>();
  speedPercent = 0;
  powerPercent = 0;
  startTime = '';
  summarySelection = 'total';
  loading = false;
  previewLoading = false;
  dragging = false;
  displayedColumns = ['index', 'timestamp', 'distance', 'speed', 'heartRate', 'cadence', 'power', 'altitude', 'temperature'];
  sensorColumns = ['index', 'timestamp', 'name', 'manufacturer', 'deviceType', 'serialNumber', 'battery', 'softwareVersion', 'sensorPosition'];
  private previewTimer?: ReturnType<typeof setTimeout>;
  private previewSequence = 0;

  constructor(private fitFiles: FitFileService, private snackBar: MatSnackBar) {}

  chooseFile(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileInput(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.load(file);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.load(file);
  }

  load(file: File): void {
    if (!file.name.toLowerCase().endsWith('.fit')) {
      this.snackBar.open('Csak .fit fájl tölthető fel.', 'Bezárás', { duration: 4000 });
      return;
    }
    this.loading = true;
    this.analysis = null;
    this.selectedPauses.clear();
    this.appliedPauses.clear();
    this.fitFiles.analyze(file).subscribe({
      next: (analysis) => {
        this.selectedFile = file;
        this.analysis = analysis;
        this.sourceAnalysis = analysis;
        this.summarySelection = 'total';
        this.displayedColumns = ['index', 'timestamp', 'distance', 'speed', 'heartRate', 'cadence', 'power', 'altitude', 'temperature']
          .filter((column) => column !== 'power' || analysis.summary.sport !== 'Futás' || analysis.summary.metrics.avgPower != null);
        this.startTime = analysis.summary.startTime ? this.toLocalInput(analysis.summary.startTime) : '';
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(error?.error?.error || 'A fájl feldolgozása sikertelen.', 'Bezárás', { duration: 6000 });
      }
    });
  }

  togglePause(id: string, checked: boolean): void {
    checked ? this.selectedPauses.add(id) : this.selectedPauses.delete(id);
  }

  applySelectedPauses(): void {
    this.appliedPauses = new Set(this.selectedPauses);
    this.schedulePreview();
  }

  get pauseSelectionChanged(): boolean {
    if (this.selectedPauses.size !== this.appliedPauses.size) return true;
    return [...this.selectedPauses].some((id) => !this.appliedPauses.has(id));
  }

  schedulePreview(): void {
    if (!this.selectedFile || !this.sourceAnalysis) return;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.refreshPreview(), 350);
  }

  private refreshPreview(): void {
    if (!this.selectedFile) return;
    const sequence = ++this.previewSequence;
    this.previewLoading = true;
    this.fitFiles.preview(this.selectedFile, this.modificationOptions()).subscribe({
      next: (analysis) => {
        if (sequence !== this.previewSequence) return;
        this.analysis = analysis;
        this.summarySelection = analysis.summary.laps.some((lap) => lap.id === this.summarySelection)
          ? this.summarySelection
          : 'total';
        this.updateDisplayedColumns(analysis);
        this.previewLoading = false;
      },
      error: (error) => {
        if (sequence !== this.previewSequence) return;
        this.previewLoading = false;
        this.snackBar.open(error?.error?.error || 'Az előnézet frissítése sikertelen.', 'Bezárás', { duration: 5000 });
      }
    });
  }

  download(): void {
    if (!this.selectedFile || !this.analysis) return;
    this.loading = true;
    this.fitFiles.modify(this.selectedFile, this.modificationOptions()).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.selectedFile!.name.replace(/\.fit$/i, '') + '-modified.fit';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Safari and some Chromium versions need the object URL to remain alive
        // until the browser has handed the response to the download manager.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.loading = false;
        this.snackBar.open('A módosított FIT fájl elkészült.', 'OK', { duration: 3500 });
      },
      error: async (error) => {
        this.loading = false;
        let message = 'A FIT fájl módosítása sikertelen.';
        if (error?.error instanceof Blob) {
          try { message = JSON.parse(await error.error.text()).error || message; } catch {}
        }
        this.snackBar.open(message, 'Bezárás', { duration: 6000 });
      }
    });
  }

  formatDuration(seconds: number): string {
    const value = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
  }

  get selectedMetrics(): FitMetrics {
    if (!this.analysis) return this.emptyMetrics;
    return this.selectedLap || this.analysis.summary.metrics;
  }

  get selectedLap(): FitLap | null {
    return this.analysis?.summary.laps.find((lap) => lap.id === this.summarySelection) || null;
  }

  get selectedNetTime(): number {
    return this.selectedLap?.netTime ?? this.analysis?.summary.netTime ?? 0;
  }

  get selectedGrossTime(): number {
    return this.selectedLap?.grossTime ?? this.analysis?.summary.grossTime ?? 0;
  }

  get selectedPauseTime(): number {
    return this.selectedLap?.pauseTime ?? this.analysis?.summary.pauseTime ?? 0;
  }

  get isRunning(): boolean {
    return this.analysis?.summary.sport === 'Futás';
  }

  formatSpeedOrPace(speed: number | null): string {
    if (speed == null || !Number.isFinite(speed) || speed <= 0) return 'NA';
    if (!this.isRunning) return `${(speed * 3.6).toFixed(1)} km/h`;
    const secondsPerKm = Math.round(1000 / speed);
    return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')} perc/km`;
  }

  displayMetric(value: number | null, suffix = '', digits = 0): string {
    return value == null || !Number.isFinite(value) ? 'NA' : `${value.toFixed(digits)}${suffix}`;
  }

  get modificationActive(): boolean {
    const originalStart = this.sourceAnalysis?.summary.startTime;
    const currentStart = this.startTime ? new Date(this.startTime).toISOString() : null;
    return this.appliedPauses.size > 0 || this.speedPercent !== 0 || this.powerPercent !== 0 ||
      Boolean(originalStart && currentStart && originalStart !== currentStart);
  }

  private modificationOptions(): object {
    return {
      pauseIds: [...this.appliedPauses],
      speedPercent: this.speedPercent,
      powerPercent: this.powerPercent,
      startTime: this.startTime ? new Date(this.startTime).toISOString() : null
    };
  }

  private updateDisplayedColumns(analysis: FitAnalysis): void {
    this.displayedColumns = ['index', 'timestamp', 'distance', 'speed', 'heartRate', 'cadence', 'power', 'altitude', 'temperature']
      .filter((column) => column !== 'power' || analysis.summary.sport !== 'Futás' || analysis.summary.metrics.avgPower != null);
  }

  private readonly emptyMetrics: FitMetrics = {
    totalAscent: null, totalDescent: null, avgHeartRate: null,
    avgPower: null, normalizedPower: null, avgCadence: null, avgSpeed: null
  };

  private toLocalInput(value: string): string {
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }
}
