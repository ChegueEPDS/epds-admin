import { Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { MailboxComponent } from './mailbox/mailbox.component';
import { DomainHealthComponent } from './domain-health/domain-health.component';
import { LicensesComponent } from './licenses/licenses.component';
import { EffortTrackingComponent } from './effort-tracking/effort-tracking.component';
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
  { path: 'effort-tracking', component: EffortTrackingComponent, canActivate: [AuthGuard], data: { featureKey: 'effortTracking' } },
  { path: 'project-tracker', loadComponent: () => import('./project-tracker/project-tracker.component').then((m) => m.ProjectTrackerComponent), canActivate: [AuthGuard], data: { featureKey: 'projectTracker' } },
  { path: 'work-settings', loadComponent: () => import('./project-tracker/project-tracker-settings.component').then((m) => m.ProjectTrackerSettingsComponent), canActivate: [AuthGuard], data: { featureKey: 'workBoard' } },
  { path: 'work-board', loadComponent: () => import('./work-board/work-board.component').then((m) => m.WorkBoardComponent), canActivate: [AuthGuard], data: { featureKey: 'workBoard' } },
  { path: 'admin/users', component: AdminUsersComponent, canActivate: [AuthGuard], data: { requiresSuperAdmin: true } },
  { path: 'admin/tenants', component: AdminTenantsComponent, canActivate: [AuthGuard], data: { requiresSuperAdmin: true } },
  { path: 'admin/integrations', component: AdminIntegrationsComponent, canActivate: [AuthGuard], data: { requiresSuperAdmin: true } },
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: '**', redirectTo: 'home' }
];
