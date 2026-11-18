import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { WorkExchangeRate, WorkReporting } from './work-fields';
import { WorkRateInfoComponent } from './work-rate-info.component';

@Component({
  selector: 'app-work-financial-entries',
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, WorkRateInfoComponent],
  template: `
    <section aria-label="Exchange rates and financial entries">
      <header><div><h3>Exchange rates & financial entries</h3>
        <p>Pipeline uses current rates. Accepted work and dated financial entries keep their fixed rates.</p></div></header>
      @if (contractEnabled) {
        <div class="acceptance">
          <p class="rate">Contract · {{ rateLabel(reporting.exchangeRates?.contract) }}<app-work-rate-info [rate]="reporting.exchangeRates?.contract"/></p>
        </div>
      }
      @for (group of visibleGroups; track group.key) {
        <div class="entry-group">
          <header><h4>{{ group.label }} · {{ currency }}</h4>
            @if (editable) {
              <button mat-stroked-button type="button" (click)="add(group.key)">
                <mat-icon class="material-symbols-outlined">add</mat-icon>
                {{ reporting[group.key] === undefined ? 'Itemize ' + group.label.toLowerCase() : 'Add entry' }}
              </button>
            }
          </header>
          @if (reporting[group.key]; as entries) {
            @for (entry of entries; track entry.id; let index = $index) {
              <div class="entry">
                @if (editable) {
                  <mat-form-field appearance="outline"><mat-label>Date</mat-label>
                    <input matInput type="date" required [max]="today" [(ngModel)]="entry.date" [ngModelOptions]="{standalone:true}">
                  </mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>{{ group.key === 'invoices' ? 'Invoice number' : 'Payment reference' }}</mat-label>
                    <input matInput maxlength="150" [(ngModel)]="entry.reference" [ngModelOptions]="{standalone:true}">
                  </mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>Amount · {{ currency }}</mat-label>
                    <input matInput type="number" required min="0.01" step="0.01" [(ngModel)]="entry.amount" (ngModelChange)="updateTotal(group.key)" [ngModelOptions]="{standalone:true}">
                  </mat-form-field>
                  <button mat-icon-button type="button" (click)="remove(group.key, index)" [attr.aria-label]="'Remove ' + group.label.toLowerCase() + ' entry ' + (index + 1)">
                    <mat-icon class="material-symbols-outlined">delete</mat-icon>
                  </button>
                } @else {
                  <span>{{ entry.date | date:'yyyy.MM.dd.' }}</span><span>{{ entry.reference || '—' }}</span>
                  <strong>{{ entry.amount | number:'1.0-2' }} {{ currency }}</strong>
                }
                <p class="rate entry-rate">{{ rateLabel(entry.date === entry.rate?.requestedDate ? entry.rate : undefined) }}<app-work-rate-info [rate]="entry.rate"/></p>
              </div>
            } @empty { <p class="muted">No entries.</p> }
            <p class="total">Total: {{ reporting[group.amount] || 0 | number:'1.0-2' }} {{ currency }}</p>
          } @else {
            <p class="muted">Existing total: {{ reporting[group.amount] == null ? 'Not entered' : (reporting[group.amount] | number:'1.0-2') }} {{ currency }}
              · {{ rateLabel(reporting.exchangeRates?.[group.key]) }}<app-work-rate-info [rate]="reporting.exchangeRates?.[group.key]"/></p>
          }
        </div>
      }
      @if (editable) { <p class="muted">Verify dates when itemizing an existing total. Rates are fixed on save; weekends and holidays use the preceding published MNB rate. Invoices are settled oldest first.</p> }
    </section>
  `,
  styles: [`
    :host { display:block; grid-column:1/-1; min-width:0; }
    section { padding:18px; border:1px solid var(--brand-border); border-radius:12px; background:var(--brand-panel); }
    header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    h3,h4 { margin:0; } h3 { font-size:15px; } h4 { font-size:13px; }
    header p,.muted,.rate { color:var(--brand-muted); font-size:12px; line-height:1.5; }
    header p { margin:5px 0 0; } .acceptance { display:flex; align-items:center; flex-wrap:wrap; gap:16px; margin-top:18px; }
    .entry-group { border-top:1px solid var(--brand-border); margin-top:18px; padding-top:16px; }
    .entry { display:grid; grid-template-columns:minmax(150px,.8fr) minmax(160px,1fr) minmax(130px,.7fr) 40px; align-items:start; gap:8px; margin-top:12px; }
    .entry mat-form-field { width:100%; } .entry-rate { grid-column:1/-1; margin:0 0 8px; }
    .total { font-size:13px; font-weight:700; text-align:right; }
    @media(max-width:700px) { .entry { grid-template-columns:minmax(0,1fr) 40px; } .entry mat-form-field { grid-column:1; } .entry button { grid-column:2; grid-row:1; } }
  `]
})
export class WorkFinancialEntriesComponent {
  @Input({ required: true }) reporting!: WorkReporting;
  @Input() currency = 'HUF';
  @Input() editable = true;
  @Input() contractEnabled = true;
  @Input() invoicesEnabled = true;
  @Input() paymentsEnabled = true;
  @Input() invoiceDate: string | null = null;
  @Input() paidAt: string | null = null;
  @Input() invoiceNumber = '';
  readonly today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(new Date());
  readonly groups = [
    { key: 'invoices', amount: 'invoicedAmount', label: 'Invoices' },
    { key: 'payments', amount: 'paidAmount', label: 'Payments' }
  ] as const;
  get visibleGroups() { return this.groups.filter((group) => group.key === 'invoices' ? this.invoicesEnabled : this.paymentsEnabled); }

  add(key: 'invoices' | 'payments'): void {
    const amountKey = key === 'invoices' ? 'invoicedAmount' : 'paidAmount';
    const existing = this.reporting[key];
    const date = key === 'invoices' ? this.invoiceDate : this.paidAt;
    const amount = existing === undefined ? this.reporting[amountKey] || 0 : 0;
    this.reporting[key] = [...(existing || []), { id: crypto.randomUUID(), date: date?.slice(0, 10) || this.today,
      reference: key === 'invoices' && !existing ? this.invoiceNumber : '', amount }];
    this.updateTotal(key);
  }
  remove(key: 'invoices' | 'payments', index: number): void {
    this.reporting[key] = this.reporting[key]?.filter((_, i) => i !== index);
    this.updateTotal(key);
  }
  updateTotal(key: 'invoices' | 'payments'): void {
    const sum = (this.reporting[key] || []).reduce((sum, entry) => sum + Math.round((Number(entry.amount) || 0) * 100), 0);
    this.reporting[key === 'invoices' ? 'invoicedAmount' : 'paidAmount'] = sum / 100;
  }
  rateLabel(rate?: WorkExchangeRate): string {
    if (!rate || rate.currency !== this.currency) return this.editable ? 'Rate will be fixed on save' : 'No fixed rate · current rate used';
    const quote = rate.snapshot.rates[this.currency];
    const value = this.currency === 'HUF' ? 1 : quote ? Number(quote.quote) / quote.unit : null;
    return `MNB ${rate.rateDate} · 1 ${this.currency} = ${value?.toLocaleString('en', { maximumFractionDigits: 6 }) ?? '—'} HUF${this.currency === 'AED' ? ' · CBUAE USD peg' : ''}${rate.estimated ? ' · Date not recorded; baseline rate' : ''}`;
  }
}
