import { UiTextPipe } from '../i18n/ui-text.pipe';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MfaApi } from './mfa-api.service';

@Component({
  standalone: true,
  imports: [UiTextPipe, FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ 'Add an extra layer of security' | uiText }}</h2>
    <mat-dialog-content>
      <p>{{ 'Turn on two-step verification to protect your account if someone gets hold of your password. Start by setting up an authenticator app in your security settings.' | uiText }}</p>
      <mat-checkbox [(ngModel)]="dismiss" [disabled]="saving">{{ 'Don’t show this again' | uiText }}</mat-checkbox>
      @if (error) { <p role="alert">{{ error }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="saving" (click)="close(false)">{{ 'Later' | uiText }}</button>
      <button mat-flat-button type="button" [disabled]="saving" (click)="close(true)">{{ 'Go to security settings' | uiText }}</button>
    </mat-dialog-actions>
  `
})
export class MfaRecommendationComponent {
  private dialog = inject(MatDialogRef<MfaRecommendationComponent, boolean>);
  private mfa = inject(MfaApi);
  dismiss = false;
  saving = false;
  error = '';

  async close(openSettings: boolean): Promise<void> {
    if (this.saving) return;
    if (this.dismiss) {
      this.saving = true;
      this.error = '';
      try {
        await this.mfa.post('dismiss');
      } catch {
        this.error = 'We couldn’t save your preference. Try again or clear the checkbox to continue.';
        this.saving = false;
        return;
      }
    }
    this.dialog.close(openSettings);
  }
}
