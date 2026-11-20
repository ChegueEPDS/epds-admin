import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { MailboxComponent } from './mailbox/mailbox.component';
import { DomainHealthComponent } from './domain-health/domain-health.component';
import { LicensesComponent } from './licenses/licenses.component';
import { WorkBoardPageComponent } from './work-board/work-board-page.component';
import { AuthService } from './services/auth.service';
import { PublicStatusComponent } from './public-status/public-status.component';
import { AdminUsersComponent } from './admin/admin-users/admin-users.component';
import { AdminTenantsComponent } from './admin/admin-tenants/admin-tenants.component';
import { AdminIntegrationsComponent } from './admin/admin-integrations/admin-integrations.component';
import { WebhookTestComponent } from './webhook-test/webhook-test.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'status/:owner', component: PublicStatusComponent, canActivate: [AuthGuard] },
  {
    path: 'webhook/docs',
    loadComponent: () => import('./webhook-docs/webhook-docs.component').then((m) => m.WebhookDocsComponent),
    canActivate: [AuthGuard],
    data: { featureKey: 'webhookTester' }
  },
  { path: 'webhook', component: WebhookTestComponent, canActivate: [AuthGuard], data: { featureKey: 'webhookTester' } },
  { path: 'home', component: HomeComponent, canActivate: [AuthGuard] },
  { path: 'mail', component: MailboxComponent, canActivate: [AuthGuard], data: { featureKey: 'mail' } },
  { path: 'domain-health', component: DomainHealthComponent, canActivate: [AuthGuard], data: { featureKey: 'domainHealth' } },
  { path: 'licenses', component: LicensesComponent, canActivate: [AuthGuard], data: { featureKey: 'licenses' } },
  {
    path: 'effort-tracking',
    loadComponent: () => import('./effort-tracking/effort-tracking.component').then((m) => m.EffortTrackingComponent),
    canActivate: [AuthGuard],
    data: { featureKey: 'effortTracking' }
  },
  {
    path: 'work-board/dashboard',
    pathMatch: 'full',
    redirectTo: ({ queryParams, fragment }) =>
      inject(Router).createUrlTree(['/project-tracker/dashboard'], { queryParams, fragment: fragment ?? undefined })
  },
  {
    path: 'work-board',
    pathMatch: 'full',
    redirectTo: ({ queryParams, fragment }) =>
      inject(Router).createUrlTree(['/project-tracker'], { queryParams, fragment: fragment ?? undefined })
  },
  {
    path: 'project-tracker/open/:tenantId',
    component: WorkBoardPageComponent,
    canActivate: [AuthGuard],
    data: { openWorkLink: true }
  },
  {
    path: 'project-tracker/finance/:tenantId',
    loadComponent: () => import('./work-board/finance-work-board-page.component').then((m) => m.FinanceWorkBoardPageComponent),
    canActivate: [AuthGuard],
    data: { requiresFinanceWorkspace: true }
  },
  {
    path: 'project-tracker',
    component: WorkBoardPageComponent,
    canActivate: [AuthGuard],
    data: { featureKey: 'workBoard' },
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./work-board/work-board.component').then((m) => m.WorkBoardComponent) },
      {
        path: 'dashboard',
        canActivate: [() => inject(AuthService).isWorkFieldTenant() || inject(Router).createUrlTree(['/project-tracker'])],
        loadComponent: () => import('./work-board/work-dashboard.component').then((m) => m.WorkDashboardComponent)
      }
    ]
  },
  { path: 'profile/security', canActivate: [AuthGuard],
    loadComponent: () => import('./security/security-profile.component').then((m) => m.SecurityProfileComponent) },
  { path: 'settings/work-fields', loadComponent: () => import('./work-board/work-field-settings.component').then((m) => m.WorkFieldSettingsComponent),
    canActivate: [AuthGuard], data: { requiresWorkFieldAdmin: true } },
  { path: 'admin/users', component: AdminUsersComponent, canActivate: [AuthGuard], data: { requiresUserManager: true } },
  { path: 'admin/tenants', component: AdminTenantsComponent, canActivate: [AuthGuard], data: { requiresSuperAdmin: true } },
  { path: 'admin/email-templates', canActivate: [AuthGuard], data: { requiresSuperAdmin: true },
    loadComponent: () => import('./admin/admin-email-templates/admin-email-templates.component').then((m) => m.AdminEmailTemplatesComponent) },
  { path: 'admin/integrations', component: AdminIntegrationsComponent, canActivate: [AuthGuard], data: { requiresSuperAdmin: true } },
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: '**', redirectTo: 'home' }
];
