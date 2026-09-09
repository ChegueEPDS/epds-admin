declare global {
  interface Window {
    __EPDS_CONFIG__?: {
      apiBaseUrl?: string;
    };
  }
}

const runtimeApiBaseUrl = window.__EPDS_CONFIG__?.apiBaseUrl?.trim();

export const environment = {
  production: true,
  apiBaseUrl: (runtimeApiBaseUrl || 'https://opsapi.epds.hu/api').replace(/\/$/, ''),
  microsoftClientId: '5e20ba3e-a873-4774-bc2b-2b69f158fc7a',
  microsoftTenantId: 'c7b7e4b5-d197-4a58-b592-4471870b8556'
};
