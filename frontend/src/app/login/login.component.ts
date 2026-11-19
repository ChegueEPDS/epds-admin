import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSnackBarModule
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  isLoading = signal(false);
  isShaking = signal(false);
  readonly passwordFormOpen = signal(false);
  email = '';
  password = '';
  newPassword = '';
  confirmPassword = '';
  resetFormOpen = false;
  notice = '';
  linkError = '';
  linkMethod: 'microsoft' | 'password' | null = null;
  linkPurpose: 'invite' | 'reset' | null = null;
  private linkToken = '';
  private linkAccount = '';
  private invitationEmail = '';
  private readonly api = environment.apiBaseUrl;

  constructor(
    private auth: AuthService,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private http: HttpClient,
    private router: Router
  ) {
    this.route.fragment.subscribe((fragment) => {
      this.notice = '';
      this.linkError = '';
      this.linkMethod = null;
      this.newPassword = '';
      this.confirmPassword = '';
      const link = new URLSearchParams(fragment || '');
      this.linkPurpose = link.has('invite') ? 'invite' : link.has('reset') ? 'reset' : null;
      this.linkAccount = link.get('account') || '';
      this.linkToken = this.linkPurpose ? link.get(this.linkPurpose) || '' : '';
      if (this.linkPurpose === 'invite') this.loadInvitation();
      if (this.linkPurpose === 'reset') this.linkMethod = 'password';
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      if (!this.linkPurpose && returnUrl) this.auth.setRedirectUrl(returnUrl);
    });
  }

  async loginWithMicrosoft(): Promise<void> {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    try {
      const invitation = this.linkPurpose === 'invite'
        ? { account: this.linkAccount, invite: this.linkToken, email: this.invitationEmail }
        : undefined;
      await this.auth.loginWithMicrosoft(invitation);
    } catch (error: any) {
      this.isShaking.set(true);
      setTimeout(() => this.isShaking.set(false), 700);
      this.snackBar.open(error?.error?.error || error?.message || 'Microsoft login failed.', 'Close', { duration: 4500 });
    } finally {
      this.isLoading.set(false);
    }
  }

  private loadInvitation(): void {
    const token = this.linkToken;
    this.http.post<{ loginMethod: 'microsoft' | 'password'; email: string }>(
      `${this.api}/auth/invitation`, { account: this.linkAccount, token }
    ).subscribe({
      next: (result) => {
        if (token !== this.linkToken) return;
        this.linkMethod = result.loginMethod;
        this.invitationEmail = result.email;
      },
      error: (error) => {
        if (token === this.linkToken) this.linkError = error?.error?.error || 'Unable to open the invitation.';
      }
    });
  }

  setPassword(): void {
    if (this.isLoading() || !this.linkPurpose) return;
    if (this.newPassword !== this.confirmPassword) {
      this.linkError = 'The passwords do not match.';
      return;
    }
    this.isLoading.set(true);
    this.linkError = '';
    this.http.post(`${this.api}/auth/set-password`, {
      account: this.linkAccount, token: this.linkToken, purpose: this.linkPurpose, password: this.newPassword
    }).subscribe({
      next: async () => {
        await this.router.navigate(['/login'], { replaceUrl: true });
        this.isLoading.set(false);
        this.passwordFormOpen.set(true);
        this.notice = 'Your password has been saved. You can now sign in.';
      },
      error: (error) => {
        this.isLoading.set(false);
        this.linkError = error?.error?.error || 'Unable to save the password.';
      }
    });
  }

  requestReset(): void {
    if (this.isLoading() || !this.email.trim()) return;
    this.isLoading.set(true);
    this.http.post(`${this.api}/auth/password-reset`, { email: this.email }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.resetFormOpen = false;
        this.notice = 'If the account supports password sign-in, a reset link will be sent to its email address.';
      },
      error: () => {
        this.isLoading.set(false);
        this.snackBar.open('Unable to request a reset link. Please try again later.', 'Close', { duration: 4500 });
      }
    });
  }

  loginWithPassword(): void {
    if (this.isLoading() || !this.passwordFormOpen()) return;
    this.isLoading.set(true);
    this.auth.loginWithPassword(this.email, this.password).subscribe({
      next: () => this.isLoading.set(false),
      error: (error) => {
        this.isLoading.set(false);
        this.isShaking.set(true);
        setTimeout(() => this.isShaking.set(false), 700);
        this.snackBar.open(error?.error?.error || 'Login failed.', 'Close', { duration: 4500 });
      }
    });
  }
}
