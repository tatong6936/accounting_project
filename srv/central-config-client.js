let _cachedToken = null;
let _tokenExpiresAt = 0;

function getXsuaaCredentials() {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const allXsuaa = vcap.xsuaa || [];
    const binding = allXsuaa.find(s => s.name === 'central-config-auth');
    if (binding) return binding.credentials;

    const url = process.env.CENTRAL_CONFIG_TOKEN_URL;
    const clientid = process.env.CENTRAL_CONFIG_CLIENT_ID;
    const clientsecret = process.env.CENTRAL_CONFIG_CLIENT_SECRET;
    if (url && clientid && clientsecret) return { url, clientid, clientsecret };

    throw new Error('central-config credentials not found. Bind central-config-auth or set CENTRAL_CONFIG_TOKEN_URL/CLIENT_ID/CLIENT_SECRET.');
}

async function getToken() {
    if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) return _cachedToken;
    const creds = getXsuaaCredentials();
    const res = await fetch(`${creds.url}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: creds.clientid,
            client_secret: creds.clientsecret
        })
    });
    if (!res.ok) throw new Error(`XSUAA token request failed: ${res.status}`);
    const { access_token, expires_in } = await res.json();
    _cachedToken = access_token;
    _tokenExpiresAt = Date.now() + expires_in * 1000;
    return _cachedToken;
}

function baseUrl() {
    return (process.env.CENTRAL_CONFIG_URL ||
        'https://it-one-co--ltd-mid-market-demo-demo-central-config-srv.cfapps.ap11.hana.ondemand.com/odata/v4/config'
    ).replace(/\/$/, '');
}

async function odataAll(entity, filter) {
    const token = await getToken();
    const qs = filter ? `?$filter=${encodeURIComponent(filter)}` : '';
    const url = `${baseUrl()}/${entity}${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`ConfigService/${entity} returned ${res.status}`);
    const { value } = await res.json();
    return value || [];
}

export async function getSAPDocumentTypeMappings(hospitalCode, hisDocumentType) {
    return odataAll('SAPDocumentTypeMapping',
        `hisHospitalCode eq '${hospitalCode}' and hisDocumentType eq '${hisDocumentType}'`);
}

export async function getDebitCreditIndicators(hospitalCode) {
    return odataAll('AccountingPostingDebitCreditIndicator',
        `hisHospitalCode eq '${hospitalCode}'`);
}

export async function getRevenueGLMappings(hospitalCode, hisDocumentType, billDate) {
    return odataAll('RevenueGLMapping',
        `hisHospitalCode eq '${hospitalCode}' and hisDocumentType eq '${hisDocumentType}' and validityStart le ${billDate} and validityEnd ge ${billDate}`);
}

export async function getCostCenterMappings(hospitalCode, billDate) {
    return odataAll('CostCenterMapping',
        `hisHospitalCode eq '${hospitalCode}' and validityStart le ${billDate} and validityEnd ge ${billDate}`);
}

export async function getPaymentMethodGLMappings(hospitalCode, hisDocumentType, billDate) {
    return odataAll('PaymentMethodGLMapping',
        `hisHospitalCode eq '${hospitalCode}' and hisDocumentType eq '${hisDocumentType}' and validityStart le ${billDate} and validityEnd ge ${billDate}`);
}
