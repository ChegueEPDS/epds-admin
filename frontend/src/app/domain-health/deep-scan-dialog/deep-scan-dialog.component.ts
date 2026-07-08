import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomainDeepScanResult, DomainHealthService, DomainMonitor, DomainPageSpeedOverview } from '../../services/domain-health.service';

@Component({
  selector: 'app-domain-deep-scan-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './deep-scan-dialog.component.html',
  styleUrl: './deep-scan-dialog.component.scss'
})
export class DomainDeepScanDialogComponent implements OnInit {
  isLoading = true;
  isRunning = false;
  error = '';
  overview: DomainPageSpeedOverview | null = null;
  result: DomainDeepScanResult | null = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { domain: DomainMonitor },
    private service: DomainHealthService
  ) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.error = '';
    try {
      this.overview = await firstValueFrom(this.service.getPageSpeed(this.data.domain.id));
      this.result = this.overview.latest;
    } catch (error: any) {
      this.error = error?.error?.error || 'PageSpeed data failed to load.';
    } finally {
      this.isLoading = false;
    }
  }

  async run(): Promise<void> {
    this.isRunning = true;
    this.error = '';
    try {
      this.result = await firstValueFrom(this.service.runPageSpeed(this.data.domain.id));
      await this.load();
    } catch (error: any) {
      this.error = error?.error?.error || 'PageSpeed scan failed.';
    } finally {
      this.isRunning = false;
    }
  }

  scoreText(value?: number | null): string {
    return typeof value === 'number' ? String(value) : '-';
  }

  scoreClass(value?: number | null): string {
    if (typeof value !== 'number') return 'score-unknown';
    if (value >= 90) return 'score-ok';
    if (value >= 50) return 'score-warning';
    return 'score-error';
  }

  savingsText(value?: number): string {
    return typeof value === 'number' ? `${value} ms` : '-';
  }

  metricMsText(value?: number | null): string {
    return typeof value === 'number' ? `${Math.round(value)} ms` : '-';
  }

  clsText(value?: number | null): string {
    return typeof value === 'number' ? value.toFixed(3) : '-';
  }

  recentHistory() {
    return [...(this.overview?.history || [])].slice(-10).reverse();
  }
}
