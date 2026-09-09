import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MailApiService {
  private base = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  sendMail(payload: {
    to: string | string[];
    subject: string;
    html: string;
    from?: string;
    cc?: string[];
    bcc?: string[];
    attachments?: { name: string; bytes: string; contentType?: string }[];
  }) {
    return this.http.post<{ ok: boolean }>(`${this.base}/mail/send`, payload);
  }

  listMailbox(folder: 'inbox' | 'sentitems', top = 25, skip = 0) {
    return this.http.get<{ mailbox: string | null; folder: string; skip?: number; items: unknown[] }>(
      `${this.base}/mailbox`,
      { params: { folder, top, skip } as Record<string, string | number> }
    );
  }

  getMailboxMessage(id: string) {
    return this.http.get<{ mailbox: string | null; item: unknown }>(
      `${this.base}/mailbox/${encodeURIComponent(id)}`
    );
  }
}
