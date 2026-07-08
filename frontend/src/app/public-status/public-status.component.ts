import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PublicStatusReport, DomainIncident, DomainStatusHistoryBucket, DomainHealthService } from '../services/domain-health.service';

@Component({
  selector: 'app-public-status',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatExpansionModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './public-status.component.html',
  styleUrl: './public-status.component.scss'
})
export class PublicStatusComponent implements OnInit, OnDestroy {
  report: PublicStatusReport | null = null;
  isLoading = false;
  error = '';
  private routeSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private service: DomainHealthService
  ) {}

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      void this.loadReport(params.get('owner') || 'all');
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  async loadReport(owner: string): Promise<void> {
    this.isLoading = true;
    this.error = '';
    try {
      this.report = await firstValueFrom(this.service.getPublicStatus(owner));
    } catch (error: any) {
      this.report = null;
      this.error = error?.error?.error || 'Failed to load status report.';
    } finally {
      this.isLoading = false;
    }
  }

  historyTitle(bucket: DomainStatusHistoryBucket): string {
    const label = bucket.status === 'ok' ? 'OK' : bucket.status === 'warning' ? 'Warning' : bucket.status === 'error' ? 'Down' : 'No data';
    const detail = typeof bucket.responseMs === 'number' ? `${bucket.responseMs} ms` : 'No sample';
    return `${label} · ${new Date(bucket.bucketStart).toLocaleString()} · ${detail}`;
  }

  incidentDurationText(incident: DomainIncident): string {
    const minutes = Math.round(incident.durationMs / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  uptimeText(value: number | null | undefined): string {
    return typeof value === 'number' ? `${value}%` : '-';
  }

  msText(value: number | null | undefined): string {
    return typeof value === 'number' ? `${value} ms` : '-';
  }

  scoreText(value: number | null | undefined): string {
    return typeof value === 'number' ? String(value) : '-';
  }

  lcpStatusText(status: string | null | undefined): string {
    if (status === 'good') return 'Good';
    if (status === 'needs improvement') return 'Needs improvement';
    if (status === 'poor') return 'Poor';
    return 'Unknown';
  }

  lcpStatusClass(status: string | null | undefined): string {
    return `lcp-${String(status || 'unknown').replace(/\s+/g, '-')}`;
  }

  tlsText(daysRemaining: number | null | undefined): string {
    if (typeof daysRemaining !== 'number') return '-';
    if (daysRemaining <= 0) return 'Expired';
    return `${daysRemaining}d`;
  }

  statusLabel(status?: string): string {
    if (status === 'error') return 'Down';
    if (status === 'warning') return 'Warning';
    if (status === 'ok') return 'Healthy';
    return 'Unknown';
  }

  exportPdf(): void {
    if (!this.report) return;
    const owner = this.report.ownerSlug || 'all';
    window.open(this.service.publicStatusPdfUrl(owner), '_blank', 'noopener');
  }
}
