import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminService, AdminTenant, AdminUser, AssignableRole, LoginMethod } from '../../services/admin.service';

type UserDialogData = {
  tenants: AdminTenant[];
  user?: AdminUser;
  isSuperAdmin: boolean;
};

@Component({
  selector: 'app-add-user-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule
  ],
  templateUrl: './add-user-dialog.component.html',
  styleUrl: './add-user-dialog.component.scss'
})
export class AddUserDialogComponent {
  saving = signal(false);
  email = '';
  loginMethod: LoginMethod = 'microsoft';
  firstName = '';
  lastName = '';
  tenantId = '';
  role: AssignableRole = 'User';
  roles: { value: AssignableRole; label: string }[] = [
    { value: 'User', label: 'User' },
    { value: 'Admin', label: 'Admin' },
    { value: 'Finance', label: 'Pénzügy' }
  ];

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: UserDialogData,
    private admin: AdminService,
    private dialogRef: MatDialogRef<AddUserDialogComponent, AdminUser>,
    private snackBar: MatSnackBar
  ) {
    if (!data.isSuperAdmin) this.roles = this.roles.filter((item) => item.value === 'User');
    if (data.tenants.length === 1) this.tenantId = data.tenants[0].id;
    const user = data.user;
    if (user) {
      this.email = user.email || '';
      this.firstName = user.firstName || '';
      this.lastName = user.lastName || '';
      this.tenantId = user.tenantId || '';
      this.role = this.roles.some((item) => item.value === user.role) ? user.role as AssignableRole : 'User';
    }
  }

  get isEditMode(): boolean {
    return Boolean(this.data.user);
  }

  get isMicrosoftUser(): boolean {
    return Boolean(this.data.user?.azureId);
  }

  onTenantChange(): void {
    if (this.data.tenants.some((tenant) => tenant.id === this.tenantId && tenant.type === 'finance')) {
      this.role = 'Finance';
    }
  }

  get title(): string {
    return this.isEditMode ? 'Edit user' : 'Add user';
  }

  get submitLabel(): string {
    return this.isEditMode ? 'Save' : 'Send invitation';
  }

  tenantLabel(tenant: AdminTenant): string {
    return tenant.displayName || tenant.name;
  }

  save(): void {
    if (this.saving() || !this.email || !this.firstName.trim() || !this.lastName.trim() || !this.tenantId) return;
    this.saving.set(true);

    const payload = {
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
      tenantId: this.tenantId,
      role: this.role
    };
    const request = this.data.user
      ? this.admin.updateUser(this.data.user.id, payload)
      : this.admin.createUser({ ...payload, loginMethod: this.loginMethod });

    request.subscribe({
      next: (user) => this.dialogRef.close(user),
      error: (error) => {
        this.saving.set(false);
        this.snackBar.open(error?.error?.error || 'User could not be saved.', 'Close', { duration: 4500 });
      }
    });
  }
}
