import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DomainHealthResult, DomainHealthService } from '../services/domain-health.service';

@Component({
  selector: 'app-domain-health',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './domain-health.component.html',
  styleUrl: './domain-health.component.scss'
})
export class DomainHealthComponent {
  domain = '';
  selector = 'default';
  isLoading = false;
  result: DomainHealthResult | null = null;

  constructor(private service: DomainHealthService, private snackBar: MatSnackBar) {}

  async check(): Promise<void> {
    const domain = this.domain.trim();
    if (!domain || this.isLoading) return;
    this.isLoading = true;
    try {
      this.result = await firstValueFrom(this.service.check(domain, this.selector.trim() || 'default'));
    } catch (error: any) {
      this.snackBar.open(error?.error?.error || 'Domain health check failed.', 'Close', { duration: 4500 });
    } finally {
      this.isLoading = false;
    }
  }

  recordEntries() {
    const records = this.result?.records;
    if (!records) return [];
    return [
      { key: 'MX', icon: 'alternate_email', record: records.mx },
      { key: 'SPF', icon: 'verified_user', record: records.spf },
      { key: 'DMARC', icon: 'policy', record: records.dmarc },
      { key: 'DKIM', icon: 'key', record: records.dkim }
    ];
  }

  valueText(value: unknown): string {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }
}
