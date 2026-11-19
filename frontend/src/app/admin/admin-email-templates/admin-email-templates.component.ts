import { UiTextPipe } from '../../i18n/ui-text.pipe';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { environment } from '../../../environments/environment';

type EmailTemplate = { id: string; label: string };

@Component({
  selector: 'app-admin-email-templates',
  imports: [UiTextPipe, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <section class="email-settings" aria-labelledby="email-settings-title">
      <header>
        <img src="/public/panda.png" alt="" width="48" height="48">
        <h1 id="email-settings-title">{{ 'Email templates' | uiText }}</h1>
      </header>
      <p>{{ 'Send a PandA test email with sample data to an address you specify.' | uiText }}</p>
      @if (loading) {
        <p role="status">{{ 'Loading templates…' | uiText }}</p>
      } @else if (loadError) {
        <p role="alert">{{ loadError | uiText }}</p>
        <button mat-stroked-button type="button" (click)="load()">{{ 'Reload templates' | uiText }}</button>
      } @else {
        <form [formGroup]="form" (ngSubmit)="send()">
          <mat-form-field appearance="outline">
            <mat-label>{{ 'Email template' | uiText }}</mat-label>
            <mat-select formControlName="template" required>
              @for (template of templates; track template.id) {
                <mat-option [value]="template.id">{{ template.label | uiText }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ 'Recipient email' | uiText }}</mat-label>
            <input matInput type="email" inputmode="email" autocomplete="email" formControlName="to" maxlength="254" required>
            <mat-error>{{ 'Enter one valid email address.' | uiText }}</mat-error>
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="form.invalid || sending">
            <mat-icon class="material-symbols-outlined">send</mat-icon>
            {{ sending ? ('Sending…' | uiText) : ('Send test email' | uiText) }}
          </button>
        </form>
        @if (success) { <p class="success" role="status">{{ 'Microsoft Graph accepted the test email for {0}.' | uiText: success }}</p> }
        @if (sendError) { <p class="error" role="alert">{{ sendError | uiText }}</p> }
      }
    </section>
  `,
  styles: `
    :host { display: block; padding: 24px 16px; }
    .email-settings {
      max-width: 640px;
      margin: 0 auto;
      padding: clamp(16px, 4vw, 32px);
      border: 1px solid var(--brand-accent-border);
      border-top: 4px solid var(--brand-primary);
      border-radius: 12px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
    }
    header { display: flex; align-items: center; gap: 14px; }
    h1 { margin: 0; font-size: 1.65rem; }
    form { display: flex; flex-direction: column; gap: 6px; margin-top: 24px; }
    button { align-self: flex-start; }
    .success, .error { padding: 10px 12px; border-radius: 6px; background: var(--mat-sys-surface-container); }
    .error { color: var(--mat-sys-error); }
  `
})
export class AdminEmailTemplatesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly url = `${environment.apiBaseUrl}/admin/email-templates`;

  readonly form = new FormGroup({
    template: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    to: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(254)] })
  });
  templates: EmailTemplate[] = [];
  loading = false;
  sending = false;
  loadError = '';
  sendError = '';
  success = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.http.get<{ templates: EmailTemplate[] }>(this.url).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.loading = false; })
    ).subscribe({
      next: ({ templates }) => { this.templates = templates; },
      error: () => { this.loadError = 'Email templates could not be loaded.'; }
    });
  }

  send(): void {
    if (this.form.invalid || this.sending) return;
    const { template, to } = this.form.getRawValue();
    this.sending = true;
    this.sendError = '';
    this.success = '';
    this.http.post(`${this.url}/${encodeURIComponent(template)}/test`, { to }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.sending = false; })
    ).subscribe({
      next: () => { this.success = to; },
      error: (error: HttpErrorResponse) => {
        this.sendError = error.error?.error || 'The test email could not be sent.';
      }
    });
  }
}
