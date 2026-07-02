import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatSnackBarModule
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  isLoading = signal(false);
  isShaking = signal(false);

  constructor(
    private auth: AuthService,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar
  ) {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl) this.auth.setRedirectUrl(returnUrl);
  }

  async loginWithMicrosoft(): Promise<void> {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    try {
      await this.auth.loginWithMicrosoft();
    } catch (error: any) {
      this.isShaking.set(true);
      setTimeout(() => this.isShaking.set(false), 700);
      this.snackBar.open(error?.error?.error || error?.message || 'Microsoft login failed.', 'Close', { duration: 4500 });
    } finally {
      this.isLoading.set(false);
    }
  }
}
