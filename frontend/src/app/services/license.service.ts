import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export type LicenseStatus = 'active' | 'inactive' | 'expired' | 'pending' | 'ordered';
export type ObjectLimitOption = '1000' | '6000' | '11000' | '16000' | '21000' | '26000' | '31000' | 'custom' | 'unlimited';
export type DatabaseServerType = 'MSSQL' | 'PostgreSQL' | 'Oracle';
export type DatabaseAuthenticationMethod = 'Native' | 'Kerberos';
export type ApplicationServerType = 'Linux' | 'Windows';
export type ContactArea = 'IT' | 'Üzlet' | 'Beszerzés';
export type AddressEnvironment = 'prod' | 'test' | 'dev';
export type CurrencyCode = 'HUF' | 'EUR' | 'USD';

export type LicenseContact = {
  name: string;
  email: string;
  phone: string;
  area: ContactArea | null;
};

export type VpnCredential = {
  username: string;
  password: string;
};

export type DatabaseAddress = {
  address: string;
  environment: AddressEnvironment;
  databaseType: DatabaseServerType | null;
};

export type TypedAddress = {
  address: string;
  environment: AddressEnvironment;
};

export type InfrastructureGroup = {
  environment: AddressEnvironment;
  applicationServerAddress: string;
  applicationServerType: ApplicationServerType | null;
  databaseServerAddress: string;
  databaseServerType: DatabaseServerType | null;
  databaseName: string;
  databaseLoginName: string;
  databaseAuthenticationMethod: DatabaseAuthenticationMethod | null;
  mailServer: string;
  mailServerPortProtocol: string;
  mailUsername: string;
  mailSenderAddress: string;
  applicationAddress: string;
};

export type LicenseFileMetadata = {
  fileName: string;
  blobPath: string;
  blobUrl: string;
  contentType: string;
  size: number;
  uploadedAt: string | null;
  uploadedByName: string;
};

export type LicenseCustomer = {
  id: string;
  customerName: string;
  description: string;
  status: LicenseStatus;
  objectLimitOption: ObjectLimitOption;
  customObjectLimit: number | null;
  objectLimit: number | 'unlimited';
  expiresAt: string;
  databaseServerAddress: string;
  databaseServerType: DatabaseServerType | null;
  applicationServerAddress: string;
  applicationServerType: ApplicationServerType | null;
  applicationAddress: string;
  databaseAddresses: DatabaseAddress[];
  applicationAddresses: TypedAddress[];
  infrastructureGroups: InfrastructureGroup[];
  accessAddresses: TypedAddress[];
  mobileApp: boolean;
  mobileAppVersion: string;
  mobileAppFile: LicenseFileMetadata | null;
  licensePrice: number;
  licenseCurrency: CurrencyCode;
  supportPrice: number;
  supportCurrency: CurrencyCode;
  contacts: LicenseContact[];
  vpnApp: string;
  twoFactorApp: string;
  vpnCredentials: VpnCredential[];
  licenseFile: LicenseFileMetadata | null;
  notesHtml: string;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantDisplayName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LicensePayload = {
  customerName: string;
  description: string;
  tenantId?: string | null;
  status: LicenseStatus;
  objectLimitOption: ObjectLimitOption;
  customObjectLimit?: number | null;
  expiresAt: string;
  databaseServerAddress: string;
  databaseServerType?: DatabaseServerType | null;
  applicationServerAddress: string;
  applicationServerType?: ApplicationServerType | null;
  applicationAddress: string;
  databaseAddresses: DatabaseAddress[];
  applicationAddresses: TypedAddress[];
  infrastructureGroups: InfrastructureGroup[];
  accessAddresses: TypedAddress[];
  mobileApp: boolean;
  mobileAppVersion: string;
  licensePrice: number;
  licenseCurrency: CurrencyCode;
  supportPrice: number;
  supportCurrency: CurrencyCode;
  contacts: LicenseContact[];
  vpnApp: string;
  twoFactorApp: string;
  vpnCredentials: VpnCredential[];
  notesHtml: string;
};

export type LicenseOrderPayload = {
  objectLimitOption: ObjectLimitOption;
  customObjectLimit?: number | null;
  mobileApp: boolean;
  mobileAppVersion?: string;
  expiresAt: string;
};

export type LicenseClientTenant = {
  id: string;
  name: string;
  displayName: string;
  type: 'client';
};

@Injectable({ providedIn: 'root' })
export class LicenseService {
  private base = `${environment.apiUrl}/api`;

  constructor(private http: HttpClient) {}

  listLicenses() {
    return this.http.get<{
      licenses: LicenseCustomer[];
      objectLimitOptions: ObjectLimitOption[];
      clientTenants?: LicenseClientTenant[];
    }>(`${this.base}/licenses`);
  }

  createLicense(payload: LicensePayload) {
    return this.http.post<{ license: LicenseCustomer }>(`${this.base}/licenses`, payload);
  }

  updateLicense(id: string, payload: LicensePayload) {
    return this.http.patch<{ license: LicenseCustomer }>(`${this.base}/licenses/${id}`, payload);
  }

  deleteLicense(id: string) {
    return this.http.delete<void>(`${this.base}/licenses/${id}`);
  }

  orderLicense(id: string, payload: LicenseOrderPayload) {
    return this.http.post<{ license: LicenseCustomer }>(`${this.base}/licenses/${id}/order`, payload);
  }

  activateLicense(id: string) {
    return this.http.post<{ license: LicenseCustomer }>(`${this.base}/licenses/${id}/activate`, {});
  }

  uploadLicenseFile(id: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ license: LicenseCustomer }>(`${this.base}/licenses/${id}/license-file`, formData);
  }

  downloadLicenseFile(id: string) {
    return this.http.get(`${this.base}/licenses/${id}/license-file`, {
      responseType: 'blob',
      observe: 'response'
    });
  }

  uploadMobileAppFile(id: string, file: File, version: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('version', version);
    return this.http.post<{ license: LicenseCustomer }>(`${this.base}/licenses/${id}/mobile-app-file`, formData);
  }

  downloadMobileAppFile(id: string) {
    return this.http.get(`${this.base}/licenses/${id}/mobile-app-file`, {
      responseType: 'blob',
      observe: 'response'
    });
  }
}
