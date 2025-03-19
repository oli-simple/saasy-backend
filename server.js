require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const OpenIdClient = require('openid-client');
const Issuer = OpenIdClient.Issuer;
const generators = OpenIdClient.generators;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5050;
const client_id = process.env.XERO_CLIENT_ID;
const client_secret = process.env.XERO_CLIENT_SECRET;
const redirect_uri = process.env.XERO_REDIRECT_URI;
const xeroScopes = process.env.XERO_SCOPES || "openid email profile accounting.transactions accounting.contacts accounting.settings offline_access";

let xeroAccessToken = process.env.XERO_ACCESS_TOKEN || null;
let xeroRefreshToken = process.env.XERO_REFRESH_TOKEN || null;
let tokenExpiresAt = process.env.XERO_TOKEN_EXPIRES || 0;

let xeroClient;

// ✅ Initialize OAuth2 Client with Xero
async function setupXeroClient() {
    try {
        const issuer = await Issuer.discover('https://identity.xero.com');
        xeroClient = new issuer.Client({
            client_id,
            client_secret,
            redirect_uris: [redirect_uri],
            response_types: ['code'],
        });
        console.log("✅ Xero OAuth2 Client Initialized Successfully");
    } catch (error) {
        console.error("❌ Error Initializing Xero Client:", error);
    }
}
setupXeroClient();

// ✅ Redirect to Xero Login
app.get('/auth/xero', (req, res) => {
    if (!xeroClient) {
        return res.status(500).json({ error: "Xero OAuth client not initialized" });
    }
    const authUrl = xeroClient.authorizationUrl({
        scope: xeroScopes,
        state: generators.state(),
    });
    res.redirect(authUrl);
});

// ✅ Handle Xero Callback & Store Tokens
app.get('/callback', async (req, res) => {
    try {
        if (!xeroClient) {
            return res.status(500).json({ error: "Xero OAuth client not initialized" });
        }

        const params = xeroClient.callbackParams(req);
        const tokenSet = await xeroClient.callback(redirect_uri, params, { state: req.query.state });

        // ✅ Store both access & refresh tokens
        xeroAccessToken = tokenSet.access_token;
        xeroRefreshToken = tokenSet.refresh_token;
        tokenExpiresAt = Date.now() + tokenSet.expires_in * 1000;

        process.env.XERO_ACCESS_TOKEN = xeroAccessToken;
        process.env.XERO_REFRESH_TOKEN = xeroRefreshToken;
        process.env.XERO_TOKEN_EXPIRES = tokenExpiresAt;

        console.log('✅ Xero Access Token:', xeroAccessToken);
        console.log('🔄 Xero Refresh Token:', xeroRefreshToken);

        res.json({ 
            success: true, 
            access_token: xeroAccessToken, 
            refresh_token: xeroRefreshToken 
        });

    } catch (error) {
        console.error('❌ Xero OAuth Error:', error);
        res.status(500).json({ error: 'OAuth authentication failed' });
    }
});

// ✅ Refresh Xero Access Token Automatically
async function refreshXeroToken() {
    if (Date.now() < tokenExpiresAt - 60000) {
        return xeroAccessToken; // ✅ Token is still valid
    }

    try {
        console.log("🔄 Refreshing Xero Access Token...");

        const response = await axios.post('https://identity.xero.com/connect/token', null, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            auth: { username: client_id, password: client_secret },
            params: {
                grant_type: 'refresh_token',
                refresh_token: xeroRefreshToken,
            },
        });

        // ✅ Update stored tokens
        xeroAccessToken = response.data.access_token;
        xeroRefreshToken = response.data.refresh_token;
        tokenExpiresAt = Date.now() + response.data.expires_in * 1000;

        process.env.XERO_ACCESS_TOKEN = xeroAccessToken;
        process.env.XERO_REFRESH_TOKEN = xeroRefreshToken;
        process.env.XERO_TOKEN_EXPIRES = tokenExpiresAt;

        console.log("✅ Successfully refreshed Xero token!");
        return xeroAccessToken;
    } catch (error) {
        console.error("❌ Failed to refresh Xero token:", error.response ? error.response.data : error);
        throw new Error("Failed to refresh Xero token");
    }
}

// ✅ Fetch Invoices from Xero API
app.get('/api/saas-expenses', async (req, res) => {
    try {
        const token = await refreshXeroToken(); // ✅ Ensure we have a fresh token
        const tenantId = process.env.XERO_TENANT_ID;

        const response = await axios.get("https://api.xero.com/api.xro/2.0/Invoices", {
            headers: { 
                Authorization: `Bearer ${token}`,
                "Xero-Tenant-Id": tenantId,
                Accept: "application/json"
            },
        });

        res.json(response.data);
    } catch (error) {
        console.error("❌ Xero API Error:", error.response ? error.response.data : error);
        res.status(500).json({ error: "Failed to fetch data from Xero" });
    }
});

// ✅ Start Server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
