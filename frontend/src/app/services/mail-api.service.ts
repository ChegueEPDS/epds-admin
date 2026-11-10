import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

type MailboxPage = {
  mailbox: string | null;
  folder: string;
  items: unknown[];
  hasMore: boolean;
  nextOlderDate?: string | null;
};

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
    return this.http.get<MailboxPage>(`${this.base}/mailbox`, { params: { folder, top, skip } });
  }

  listMailboxRange(folder: 'inbox' | 'sentitems', since: string, before: string) {
    return this.http.get<MailboxPage>(`${this.base}/mailbox`, { params: { folder, since, before } });
  }

  getMailboxMessage(id: string) {
    return this.http.get<{ mailbox: string | null; item: unknown }>(
      `${this.base}/mailbox/${encodeURIComponent(id)}`
    );
  }

  forwardMessage(id: string, payload: { to: string[]; comment: string }) {
    return this.http.post<{ ok: boolean }>(`${this.base}/mailbox/${encodeURIComponent(id)}/forward`, payload);
  }
}
