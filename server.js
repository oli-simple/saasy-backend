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

let xeroClient;

// Initialize OAuth2 Client
async function setupXeroClient() {
    const issuer = await Issuer.discover('https://identity.xero.com');
    xeroClient = new issuer.Client({
        client_id,
        client_secret,
        redirect_uris: [redirect_uri],
        response_types: ['code'],
    });
}
setupXeroClient();

// Redirect to Xero Login
app.get('/auth/xero', (req, res) => {
    const authUrl = xeroClient.authorizationUrl({
        scope: 'accounting.transactions accounting.contacts openid profile email',
        state: generators.state(),
    });
    res.redirect(authUrl);
});

// Handle Xero Callback & Get Token
app.get('/callback', async (req, res) => {
    try {
        const params = xeroClient.callbackParams(req);
        const tokenSet = await xeroClient.callback(redirect_uri, params, { state: req.query.state });

        console.log('Xero Access Token:', tokenSet.access_token);
        res.json({ success: true, access_token: tokenSet.access_token });
    } catch (error) {
        console.error('Xero OAuth Error:', error);
        res.status(500).json({ error: 'OAuth authentication failed' });
    }
});

// Fetch Expenses from Xero API
app.get('/api/saas-expenses', async (req, res) => {
    try {
        const token = req.query.token;
        if (!token) return res.status(401).json({ error: "Missing access token" });

        const response = await axios.get("https://api.xero.com/api.xro/2.0/Invoices", {
            headers: { Authorization: `Bearer ${token}` },
        });

        const invoices = response.data.Invoices.map(invoice => ({
            name: invoice.Contact.Name,
            cost: `$${invoice.Total} AUD`,
        }));

        res.json({ subscriptions: invoices });
    } catch (error) {
        console.error("Xero API Error:", error);
        res.status(500).json({ error: "Failed to fetch data from Xero" });
    }
});

// Start Server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
