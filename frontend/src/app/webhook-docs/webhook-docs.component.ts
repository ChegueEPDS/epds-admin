import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';

type DocEndpoint = {
  method: string;
  path: string;
  title: string;
  description: string;
};

@Component({
  selector: 'app-webhook-docs',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, RouterLink],
  templateUrl: './webhook-docs.component.html',
  styleUrl: './webhook-docs.component.scss'
})
export class WebhookDocsComponent {
  readonly apiUrl = environment.apiUrl.replace(/\/$/, '');
  readonly basePath = '/api/integrations/v1';

  readonly endpoints: DocEndpoint[] = [
    {
      method: 'GET',
      path: '/licenses?limit=50&updatedAfter=2026-07-10T00:00:00.000Z',
      title: 'Poll licenses',
      description: 'List every license visible to the integration client. Sensitive VPN, notes, infrastructure credentials and blob paths are not exposed.'
    },
    {
      method: 'GET',
      path: '/events?limit=50&occurredAfter=2026-07-10T00:00:00.000Z',
      title: 'Poll ordered events',
      description: 'Read license.ordered events. Consumers should store event IDs and deduplicate repeated processing.'
    },
    {
      method: 'POST',
      path: '/licenses/<license-id>/license-file',
      title: 'Upload license file',
      description: 'Upload the generated license file with multipart/form-data after receiving an ordered event.'
    },
    {
      method: 'POST',
      path: '/licenses/<license-id>/mobile-app-file',
      title: 'Upload mobile app APK',
      description: 'Upload an APK when the license has mobileApp enabled. The previous APK is replaced.'
    }
  ];

  readonly webhookPayload = `{
  "id": "061f6b3e-7c95-43de-9c83-72ac2e4cd936",
  "type": "license.ordered",
  "occurredAt": "2026-07-10T10:00:00.000Z",
  "data": {
    "previousStatus": "active",
    "status": "ordered",
    "license": {
      "id": "...",
      "customerName": "Example Customer",
      "description": "Production",
      "status": "ordered",
      "objectLimit": 6000,
      "expiresAt": "2027-12-31T00:00:00.000Z",
      "mobileApp": true,
      "mobileAppVersion": "1.4.0",
      "licenseFile": null,
      "mobileAppFile": {
        "fileName": "epds-mobile.apk",
        "contentType": "application/vnd.android.package-archive",
        "size": 52428800,
        "uploadedAt": "2026-07-10T10:05:00.000Z"
      }
    }
  }
}`;

  readonly uploadExample = `curl -X POST "${this.apiUrl}${this.basePath}/licenses/<license-id>/license-file" \\
  -H "Authorization: Bearer $EPDS_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -F "file=@license.zip"`;

  readonly mobileUploadExample = `curl -X POST "${this.apiUrl}${this.basePath}/licenses/<license-id>/mobile-app-file" \\
  -H "Authorization: Bearer $EPDS_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -F "version=1.4.0" \\
  -F "file=@epds-mobile.apk"`;

  readonly pollEventsExample = `curl "${this.apiUrl}${this.basePath}/events?limit=50" \\
  -H "Authorization: Bearer $EPDS_API_KEY"`;

  readonly signatureBase = `signed_payload = timestamp + "." + raw_request_body
expected = HMAC_SHA256(webhook_secret, signed_payload)
header = "X-EPDS-Signature: v1=" + expected`;
}
