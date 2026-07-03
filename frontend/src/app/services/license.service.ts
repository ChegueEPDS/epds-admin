import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export type LicenseStatus = 'active' | 'inactive';
export type ObjectLimitOption = '1000' | '6000' | '11000' | '16000' | '21000' | '26000' | '31000' | 'custom' | 'unlimited';
export type DatabaseServerType = 'MSSQL' | 'PostgreSQL' | 'Oracle';
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
  applicationAddress: string;
};

export type LicenseCustomer = {
  id: string;
  customerName: string;
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
  licensePrice: number;
  licenseCurrency: CurrencyCode;
  supportPrice: number;
  supportCurrency: CurrencyCode;
  contacts: LicenseContact[];
  vpnApp: string;
  twoFactorApp: string;
  vpnCredentials: VpnCredential[];
  notesHtml: string;
  tenantId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LicensePayload = {
  customerName: string;
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

@Injectable({ providedIn: 'root' })
export class LicenseService {
  private base = `${environment.apiUrl}/api`;

  constructor(private http: HttpClient) {}

  listLicenses() {
    return this.http.get<{ licenses: LicenseCustomer[]; objectLimitOptions: ObjectLimitOption[] }>(`${this.base}/licenses`);
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
}
