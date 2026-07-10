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
  { path: 'status/:owner', component: PublicStatusComponent },
  { path: 'webhook', component: WebhookTestComponent },
  { path: 'home', component: HomeComponent, canActivate: [AuthGuard] },
  { path: 'mail', component: MailboxComponent, canActivate: [AuthGuard], data: { featureKey: 'mail' } },
  { path: 'domain-health', component: DomainHealthComponent, canActivate: [AuthGuard], data: { featureKey: 'domainHealth' } },
  { path: 'licenses', component: LicensesComponent, canActivate: [AuthGuard], data: { featureKey: 'licenses' } },
  { path: 'effort-tracking', component: EffortTrackingComponent, canActivate: [AuthGuard], data: { featureKey: 'effortTracking' } },
  { path: 'admin/users', component: AdminUsersComponent, canActivate: [AuthGuard], data: { requiresSuperAdmin: true } },
  { path: 'admin/tenants', component: AdminTenantsComponent, canActivate: [AuthGuard], data: { requiresSuperAdmin: true } },
  { path: 'admin/integrations', component: AdminIntegrationsComponent, canActivate: [AuthGuard], data: { requiresSuperAdmin: true } },
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: '**', redirectTo: 'home' }
];
