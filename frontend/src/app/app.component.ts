import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { AuthService } from './services/auth.service';
import { AdminService, AdminTenant } from './services/admin.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatToolbarModule,
    MatTooltipModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  isPublicRoute = false;
  currentUrl = '';
  tenants: AdminTenant[] = [];
  tenantContextId = '';
  private tenantListLoaded = false;

  constructor(
    public auth: AuthService,
    public theme: ThemeService,
    private admin: AdminService,
    private router: Router
  ) {
    this.currentUrl = this.router.url;
    this.isPublicRoute = this.isPublicPath(this.currentUrl);
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentUrl = (event as NavigationEnd).urlAfterRedirects;
        this.isPublicRoute = this.isPublicPath(this.currentUrl);
      });
    this.auth.user$.subscribe((user) => {
      if (user?.role === 'SuperAdmin' && !this.tenantListLoaded) this.loadTenantContexts();
      if (user?.role !== 'SuperAdmin') {
        this.tenants = [];
        this.tenantContextId = '';
        this.tenantListLoaded = false;
      }
    });
  }

  private loadTenantContexts(): void {
    this.tenantListLoaded = true;
    this.admin.listTenants().subscribe({
      next: (tenants) => {
        this.tenants = tenants;
        const selected = this.auth.restoreTenantContext(tenants);
        this.tenantContextId = selected?.id || '';
      },
      error: () => { this.tenantListLoaded = false; }
    });
  }

  tenantLabel(tenant: AdminTenant): string {
    return tenant.displayName || tenant.name;
  }

  changeTenantContext(tenantId: string): void {
    const tenant = this.tenants.find((item) => item.id === tenantId) || null;
    this.auth.setTenantContext(tenant);
    window.location.reload();
  }

  get financeTenantId(): string {
    return this.currentPath.match(/^\/project-tracker\/finance\/([^/]+)$/)?.[1] || '';
  }

  changeFinanceTenant(tenantId: string): void {
    void this.router.navigate(tenantId ? ['/project-tracker', 'finance', tenantId] : ['/home']);
  }

  get isWebhookSectionActive(): boolean {
    return this.currentPath.startsWith('/webhook');
  }

  get isWebhookTesterRoute(): boolean {
    return this.currentPath === '/webhook';
  }

  private isPublicPath(url: string): boolean {
    return url.startsWith('/status/');
  }

  private get currentPath(): string {
    return this.currentUrl.split(/[?#]/)[0] || '/';
  }

  preventCurrentWebhookClick(event: MouseEvent): void {
    if (!this.isWebhookTesterRoute) return;
    event.preventDefault();
    event.stopPropagation();
  }

  logout(): void {
    this.auth.logout();
  }
}
