import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../services/auth.service';
import { MfaApi, MfaSetup, MfaStatus, mfaError } from './mfa-api.service';
import { MfaSetupComponent } from './mfa-setup.component';
import { RecoveryCodesComponent } from './recovery-codes.component';

type SecurityAction = 'setup' | 'passkey' | 'recovery' | 'remove' | 'disable';
const actionLabels: Record<SecurityAction, string> = {
  setup: 'Set up authenticator app',
  passkey: 'Add passkey',
  recovery: 'Replace recovery codes',
  remove: 'Remove passkey',
  disable: 'Turn off two-step verification'
};

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MfaSetupComponent, RecoveryCodesComponent],
  template: `
    <main class="profile">
      <h1>Profile</h1>
      <p>{{ auth.getFullName() }} · {{ auth.getCurrentUser()?.email }}</p>
      <mat-card appearance="outlined">
        <mat-card-content>
          <h2>Security</h2>
          @if (error) { <p role="alert">{{ error }}</p> }
          @if (loading) { <p role="status">Updating security settings…</p> }
          @if (codes.length) {
            <app-recovery-codes [codes]="codes" (done)="finishCodes()"/>
          } @else if (setup; as enrollment) {
            <h3>Set up your authenticator app</h3>
            <app-mfa-setup [setup]="enrollment"/>
            <form #verification="ngForm" (ngSubmit)="confirmSetup()">
              <mat-form-field appearance="outline">
                <mat-label>Six-digit code</mat-label>
                <input matInput name="code" [(ngModel)]="code" inputmode="numeric" autocomplete="one-time-code"
                  pattern="[0-9]{6}" maxlength="6" required>
              </mat-form-field>
              <div class="actions">
                <button mat-flat-button type="submit" [disabled]="loading || verification.invalid">Verify code</button>
                <button mat-button type="button" [disabled]="loading" (click)="cancel()">Cancel</button>
              </div>
            </form>
          } @else if (action; as selected) {
            <h3>{{ labels[selected] }}</h3>
            @if (selected === 'recovery') {
              <p>A new set will immediately invalidate all previous recovery codes.</p>
            }
            @if (selected === 'disable') {
              <p>This removes the authenticator app, saved passkeys and recovery codes from your account and signs you out.</p>
            }
            @if (status?.enabled) {
              <p>For your protection, make this change within 10 minutes of signing in.</p>
            }
            <form #credentials="ngForm" (ngSubmit)="applyAction(selected)">
              <mat-form-field appearance="outline">
                <mat-label>Current password</mat-label>
                <input matInput name="password" type="password" autocomplete="current-password" [(ngModel)]="password" required>
              </mat-form-field>
              @if (selected === 'passkey') {
                <mat-form-field appearance="outline">
                  <mat-label>Passkey name</mat-label>
                  <input matInput name="passkeyName" [(ngModel)]="passkeyName" maxlength="80" placeholder="Work laptop">
                </mat-form-field>
              }
              <div class="actions">
                <button mat-flat-button type="submit" [disabled]="loading || credentials.invalid">{{ labels[selected] }}</button>
                <button mat-button type="button" [disabled]="loading" (click)="cancel()">Cancel</button>
              </div>
            </form>
          } @else if (status; as info) {
            @if (!info.available) {
              <p>Your account uses Microsoft sign-in. Manage sign-in methods in your Microsoft account.</p>
            } @else {
              <h3>Two-step verification</h3>
              @if (info.enabled) {
                <p>Your authenticator app is active. You can also use a passkey or a recovery code to finish signing in.</p>
                <button mat-stroked-button type="button" (click)="select('setup')">Replace authenticator app</button>
                <h3>Passkeys</h3>
                <p>When a passkey is available, we’ll offer it first after you enter your password.</p>
                @for (key of info.passkeys; track key.id) {
                  <div class="key">
                    <span>{{ key.name }}</span>
                    <button mat-button type="button" [attr.aria-label]="'Remove ' + key.name" (click)="select('remove', key.id)">Remove</button>
                  </div>
                }
                @if (info.passkeyAvailable) {
                  <button mat-stroked-button type="button" [disabled]="!supportsPasskeys" (click)="select('passkey')">Add passkey</button>
                  @if (!supportsPasskeys) { <p>This browser does not support passkeys.</p> }
                }
                <h3>Recovery codes</h3>
                <p>{{ info.recoveryRemaining }} unused codes</p>
                <button mat-stroked-button type="button" (click)="select('recovery')">Generate new codes</button>
                @if (!info.required) {
                  <div class="actions"><button mat-button type="button" (click)="select('disable')">Turn off two-step verification</button></div>
                }
              } @else {
                <p>Add a verification step after your password to protect your account.</p>
                <button mat-flat-button type="button" (click)="select('setup')">Turn on two-step verification</button>
              }
            }
          } @else if (error && !loading) {
            <button mat-button type="button" (click)="load()">Try again</button>
          }
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styles: [`
    .profile { max-width: 720px; padding: 24px 16px; margin: auto; }
    mat-card-content { padding: 24px; }
    mat-form-field { display: block; max-width: 360px; }
    .actions, .key { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 12px 0; }
    [role=alert] { color: var(--mat-sys-error, #b3261e); }
  `]
})
export class SecurityProfileComponent implements OnInit {
  readonly auth = inject(AuthService);
  private mfa = inject(MfaApi);
  readonly supportsPasskeys = window.isSecureContext && !!window.PublicKeyCredential;
  readonly labels = actionLabels;
  status?: MfaStatus;
  action?: SecurityAction;
  setup?: MfaSetup;
  password = '';
  passkeyName = '';
  keyToRemove = '';
  code = '';
  error = '';
  loading = false;
  codes: string[] = [];
  private signOutAfterCodes = false;

  ngOnInit(): void { void this.load(); }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.loading) return;
    this.error = '';
    this.loading = true;
    try {
      await operation();
    } catch (error) {
      this.error = mfaError(error, 'We couldn’t update your security settings. Please try again.');
    } finally {
      this.loading = false;
    }
  }

  async load(): Promise<void> {
    await this.run(async () => { this.status = await this.mfa.status(); });
  }

  select(action: SecurityAction, id = ''): void {
    this.cancel();
    this.action = action;
    this.keyToRemove = id;
  }

  cancel(): void {
    this.setup = undefined;
    this.action = undefined;
    this.error = this.password = this.code = this.passkeyName = this.keyToRemove = '';
  }

  async applyAction(action: SecurityAction): Promise<void> {
    await this.run(async () => {
      const password = this.password;
      this.password = '';
      if (action === 'setup') {
        this.setup = await this.mfa.post<MfaSetup>('setup', { password });
        return;
      }
      if (action === 'passkey') {
        const response = await this.mfa.register(password);
        this.status = await this.mfa.post<MfaStatus>('passkey/confirm', { response, name: this.passkeyName });
      } else if (action === 'remove') {
        this.status = await this.mfa.post<MfaStatus>('passkey/remove', { password, id: this.keyToRemove });
      } else if (action === 'recovery') {
        const result = await this.mfa.post<{ recoveryCodes: string[] }>('recovery', { password });
        this.codes = result.recoveryCodes;
        if (this.status) this.status.recoveryRemaining = this.codes.length;
      } else {
        await this.mfa.post('disable', { password });
        this.auth.logout();
      }
      this.cancel();
    });
  }

  async confirmSetup(): Promise<void> {
    await this.run(async () => {
      const result = await this.mfa.post<{ recoveryCodes: string[] }>('confirm', { code: this.code });
      this.codes = result.recoveryCodes;
      this.signOutAfterCodes = true;
      this.cancel();
    });
  }

  finishCodes(): void {
    this.codes = [];
    if (this.signOutAfterCodes) {
      this.auth.setRedirectUrl('/profile/security');
      this.auth.logout();
    }
  }
}
