import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkExchangeRate } from './work-fields';

@Component({
  imports: [CommonModule, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>How exchange rates are fixed</h2>
    <mat-dialog-content>
      @if (rate) {
        <section class="saved-rate" aria-label="Saved exchange rate">
          <h3>This saved rate · {{ rate.currency }}</h3>
          <dl>
            <div><dt>Event date used</dt><dd>{{ rate.requestedDate | date:'yyyy.MM.dd.' }}</dd></div>
            <div><dt>MNB publication date</dt><dd>{{ rate.rateDate | date:'yyyy.MM.dd.' }}</dd></div>
            <div><dt>Fixed on save</dt><dd>{{ rate.fixedAt | date:'yyyy.MM.dd. HH:mm' }}</dd></div>
          </dl>
          @if (rate.estimated) { <p>The original event date was not recorded. This is a marked baseline rate. Enter the actual event date to fix the corresponding historical rate.</p> }
        </section>
      }
      <p>Amounts stay in the work’s original currency. These rules apply when converting them to the tenant’s default currency.</p>
      <div class="rules">
        @for (rule of rules; track rule.title) {
          <section><h3>{{ rule.title }}</h3><p><strong>When:</strong> {{ rule.when }}</p><p><strong>Why:</strong> {{ rule.why }}</p></section>
        }
      </div>
      <h3>Dates, corrections and existing works</h3>
      <p>A rate is fixed when you save. The event date chooses the rate; it can differ from the save date. Weekends and holidays use the preceding published MNB rate.</p>
      <p>Ordinary edits and amount corrections keep the saved rate. Changing an event date fixes the rate for the corrected date. Missing historical rates stop the save that needs a new rate.</p>
      <p>Existing amounts without fixed rates use current rates and are flagged on the dashboard. On their next save, known event dates are used; missing dates receive a marked baseline. An unknown acceptance date is never inferred from the work’s creation date.</p>
      <p class="source">Source: MNB. AED uses the dated MNB USD rate and the 3.6725 AED/USD peg. Changing the tenant’s default currency keeps the historical snapshots.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-flat-button mat-dialog-close type="button">Close</button></mat-dialog-actions>
  `,
  styles: [`
    :host { display:block; color:var(--brand-ink); background:var(--brand-panel); }
    h3 { margin:18px 0 8px; font-size:14px; font-weight:700; color:var(--brand-ink); }
    p { margin:6px 0 12px; line-height:1.6; font-size:13px; color:var(--brand-muted); }
    .saved-rate { padding:14px 16px; border:1px solid var(--brand-border); border-radius:10px; background:var(--brand-panel-soft); }
    .saved-rate h3 { margin-top:0; } dl { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:12px 0 0; }
    dt { font-size:11px; color:var(--brand-muted); } dd { margin:4px 0 0; font-size:13px; font-weight:600; color:var(--brand-ink); }
    .rules { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:18px 0; }
    .rules section { padding:14px; border:1px solid var(--brand-border); border-radius:10px; }
    .rules h3 { margin:0 0 8px; } .rules p:last-child { margin-bottom:0; }
    .source { border-top:1px solid var(--brand-border); padding-top:12px; font-size:12px; }
    @media(max-width:600px) { .rules,dl { grid-template-columns:1fr; } }
  `]
})
class WorkRateInfoDialogComponent {
  readonly rate = inject<WorkExchangeRate | null>(MAT_DIALOG_DATA);
  readonly rules = [
    { title: 'Pipeline', when: 'Uses the latest available daily rate; no rate is fixed.', why: 'An open opportunity reflects its current estimated value.' },
    { title: 'Accepted work', when: 'Uses the order acceptance date. Without an entered date, the day the work becomes accepted or the contract is marked signed is recorded.', why: 'The agreed value remains stable after acceptance. If its amount is entered later, the recorded acceptance date still applies.' },
    { title: 'Invoices & receivables', when: 'Each dated invoice keeps its invoice-date rate. Payments settle invoices oldest first in the original currency.', why: 'Only the unpaid part remains a receivable at that invoice’s rate. A fully paid invoice leaves no exchange-rate balance.' },
    { title: 'Payments', when: 'Each payment keeps its payment-date rate, including receipts entered on sub-works.', why: 'Received amounts reflect the date of receipt. A work’s entered payment total takes precedence over sub-work totals.' },
    { title: 'Not yet invoiced', when: 'The unbilled balance uses the work’s fixed acceptance rate.', why: 'The remaining agreed work value stays consistent with the accepted contract.' }
  ];
}

@Component({
  selector: 'app-work-rate-info',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatTooltipModule],
  template: `<button mat-icon-button type="button" aria-label="How exchange rates are fixed"
    matTooltip="How exchange rates are fixed" (click)="open($event)">
    <mat-icon class="material-symbols-outlined" aria-hidden="true">info</mat-icon>
  </button>`,
  styles: [`
    :host { display:inline-flex; vertical-align:middle; margin-inline-start:4px; }
    button { width:30px; height:30px; padding:6px; color:var(--brand-muted); --mdc-icon-button-state-layer-size:30px; }
    mat-icon { width:18px; height:18px; font-size:18px; }
  `]
})
export class WorkRateInfoComponent {
  @Input() rate?: WorkExchangeRate;
  private readonly dialog = inject(MatDialog);
  open(event: Event): void {
    event.stopPropagation();
    this.dialog.open(WorkRateInfoDialogComponent, {
      data: this.rate || null, width: '760px', maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh', autoFocus: 'first-heading'
    });
  }
}
