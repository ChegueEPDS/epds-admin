import { CommonModule } from '@angular/common';
import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminService, AdminTenant, AdminUser, AssignableRole } from '../../services/admin.service';

type UserDialogData = {
  tenants: AdminTenant[];
  user?: AdminUser;
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
  password = '';
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

  get title(): string {
    return this.isEditMode ? 'Edit user' : 'Add user';
  }

  get submitLabel(): string {
    return this.isEditMode ? 'Save' : 'Create';
  }

  tenantLabel(tenant: AdminTenant): string {
    return tenant.displayName || tenant.name;
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);

    const payload = {
      email: this.email,
      password: this.password,
      firstName: this.firstName,
      lastName: this.lastName,
      tenantId: this.tenantId,
      role: this.role
    };
    const request = this.data.user
      ? this.admin.updateUser(this.data.user.id, payload)
      : this.admin.createUser(payload);

    request.subscribe({
      next: (user) => this.dialogRef.close(user),
      error: (error) => {
        this.saving.set(false);
        this.snackBar.open(error?.error?.error || 'User could not be saved.', 'Close', { duration: 4500 });
      }
    });
  }
}
