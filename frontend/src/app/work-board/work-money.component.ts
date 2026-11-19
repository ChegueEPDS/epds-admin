import { UiLanguageService } from '../i18n/ui-language.service';
import { Component, Input, OnChanges, effect, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkExchangeRate } from './work-fields';

export type WorkRateSnapshot = WorkExchangeRate['snapshot'];
type MoneyPart = { amount: number; rate?: WorkExchangeRate };

@Component({
  selector: 'app-work-money',
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <span class="original">{{ original }}
      @if (tooltip) {
        <button type="button" class="rate-info" [matTooltip]="tooltip" [attr.aria-label]="tooltip">
          <mat-icon class="material-symbols-outlined" aria-hidden="true">info</mat-icon>
        </button>
      }
    </span>
    @if (converted) { <small [matTooltip]="tooltip">{{ converted }}</small> }
  `,
  styles: [`
    :host { display: inline-flex; flex-direction: column; align-items: inherit; max-width: 100%; vertical-align: top; text-transform: none; }
    .original { display: inline-flex; align-items: flex-start; gap: 4px; }
    small { color: var(--brand-muted); font-size: .8em; font-weight: 500; line-height: 1.3; }
    .rate-info { display: inline-flex; padding: 0; border: 0; background: none; color: var(--brand-muted); cursor: help; }
    mat-icon { width: 14px; height: 14px; font-size: 14px; }
  `]
})
export class WorkMoneyComponent implements OnChanges {
  private readonly ui = inject(UiLanguageService);
  @Input({ required: true }) amount = 0;
  @Input({ required: true }) currency = '';
  @Input({ required: true }) target = '';
  @Input() current?: WorkRateSnapshot;
  @Input() rate?: WorkExchangeRate;
  @Input() entries?: MoneyPart[];

  original = '';
  converted = '';
  tooltip = '';

  constructor() {
    effect(() => {
      this.ui.language();
      this.updateDisplay();
    });
  }

  ngOnChanges(): void {
    this.updateDisplay();
  }

  private updateDisplay(): void {
    this.original = this.money(this.amount, this.currency);
    this.converted = '';
    this.tooltip = '';
    if (!this.target || this.currency === this.target) return;
    let total = 0;
    const details = new Set<string>();
    const parts = this.entries?.length ? this.entries : [{ amount: this.amount, rate: this.rate }];
    for (const part of parts) {
      const snapshot = part.rate?.snapshot ?? this.current;
      const source = this.quote(this.currency, snapshot);
      const target = this.quote(this.target, snapshot);
      if (!snapshot || !source || !target) {
        this.tooltip = this.ui.text('Exchange rate unavailable');
        return;
      }
      const rate = source / target;
      total += part.amount * rate;
      const displayed = new Intl.NumberFormat(this.ui.locale(), { maximumSignificantDigits: 8 }).format(rate);
      const basis = part.rate?.estimated ? this.ui.text(' · Baseline') : part.rate ? '' : this.ui.text(' · Latest available');
      details.add(`MNB ${snapshot.date} · 1 ${this.currency} = ${displayed} ${this.target}${basis}`);
    }
    this.converted = this.money(total, this.target);
    this.tooltip = [...details].join(' / ');
  }

  private quote(currency: string, snapshot?: WorkRateSnapshot): number {
    if (currency === 'HUF') return 1;
    const entry = snapshot?.rates[currency];
    return entry ? Number(entry.quote) / entry.unit : 0;
  }

  private money(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.ui.locale(), { style: 'currency', currency, maximumFractionDigits: currency === 'HUF' ? 0 : 2 }).format(amount);
  }
}
