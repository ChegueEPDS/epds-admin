const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');

let client;

function getGraphClient() {
  if (client) return client;
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET are required');
  }

  const authProvider = new TokenCredentialAuthenticationProvider(
    new ClientSecretCredential(tenantId, clientId, clientSecret),
    {
      scopes: ['https://graph.microsoft.com/.default']
    }
  );
  client = Client.initWithMiddleware({
    authProvider
  });
  return client;
}

module.exports = { getGraphClient };
