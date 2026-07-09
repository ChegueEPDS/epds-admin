import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
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
  email = '';
  password = '';

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

  loginWithPassword(): void {
    if (this.isLoading()) return;
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
