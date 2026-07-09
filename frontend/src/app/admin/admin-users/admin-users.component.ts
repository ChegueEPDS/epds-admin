import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AdminService, AdminTenant, AdminUser, AssignableRole } from '../../services/admin.service';
import { AddUserDialogComponent } from './add-user-dialog.component';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule
  ],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss'
})
export class AdminUsersComponent implements OnInit {
  users = signal<AdminUser[]>([]);
  tenants = signal<AdminTenant[]>([]);
  loading = signal(false);
  displayedColumns = ['name', 'email', 'role', 'tenant', 'lastLogin', 'actions'];
  roles: { value: AssignableRole; label: string }[] = [
    { value: 'User', label: 'User' },
    { value: 'Admin', label: 'Admin' },
    { value: 'Finance', label: 'Pénzügy' }
  ];

  constructor(
    private admin: AdminService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.admin.listTenants().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.admin.listUsers().subscribe({
          next: (users) => {
            this.users.set(users);
            this.loading.set(false);
          },
          error: () => this.failLoad()
        });
      },
      error: () => this.failLoad()
    });
  }

  openEditUser(user: AdminUser): void {
    if (user.role === 'SuperAdmin') return;
    const ref = this.dialog.open(AddUserDialogComponent, {
      width: '560px',
      maxWidth: 'calc(100vw - 32px)',
      data: { tenants: this.tenants(), user }
    });

    ref.afterClosed().subscribe((updated: AdminUser | undefined) => {
      if (!updated) return;
      this.users.set(this.users().map((item) => item.id === updated.id ? updated : item));
      this.snackBar.open('User saved.', 'Close', { duration: 3000 });
    });
  }

  openAddUser(): void {
    const ref = this.dialog.open(AddUserDialogComponent, {
      width: '560px',
      maxWidth: 'calc(100vw - 32px)',
      data: { tenants: this.tenants() }
    });

    ref.afterClosed().subscribe((created: AdminUser | undefined) => {
      if (!created) return;
      this.users.set([...this.users(), created].sort((a, b) => a.email.localeCompare(b.email)));
      this.snackBar.open('User created.', 'Close', { duration: 3000 });
    });
  }

  roleLabel(role: string): string {
    return this.roles.find((item) => item.value === role)?.label || role;
  }

  private failLoad(): void {
    this.loading.set(false);
    this.snackBar.open('Admin data could not be loaded.', 'Close', { duration: 4500 });
  }
}
