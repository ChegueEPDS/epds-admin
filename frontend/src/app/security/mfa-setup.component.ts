import { UiTextPipe } from '../i18n/ui-text.pipe';
import { Component, Input } from '@angular/core';
import { MfaSetup } from './mfa-api.service';

@Component({
  selector: 'app-mfa-setup',
  standalone: true,
  imports: [UiTextPipe],
  template: `
    <p>{{ 'Scan this QR code with your authenticator app, then enter the six-digit code it displays.' | uiText }}</p>
    <img [src]="setup.qr" width="220" height="220" alt="{{ 'QR code for setting up your authenticator app' | uiText }}">
    <details>
      <summary>{{ 'Enter setup key manually' | uiText }}</summary>
      <p>{{ 'Add a time-based account named EPDS Admin in your authenticator app and enter this key.' | uiText }}</p>
      <code>{{ setup.key }}</code>
    </details>
  `,
  styles: [`img { display: block; max-width: 100%; height: auto; border-radius: 8px; margin: 12px auto; }
    details { margin: 12px 0 16px; } summary { cursor: pointer; } code { overflow-wrap: anywhere; }`]
})
export class MfaSetupComponent {
  @Input({ required: true }) setup!: MfaSetup;
}
