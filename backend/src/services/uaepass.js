'use strict';

// UAE Pass OAuth 2.0 / OpenID Connect client.
//
// Flow:
//   1. buildAuthorizeUrl()  — redirect the user's browser here
//   2. UAE Pass authenticates and redirects back to our redirect_uri with ?code=…&state=…
//   3. exchangeCodeForToken() — POST to /token to swap the code for an access_token
//   4. getUserInfo()         — GET /userinfo with Bearer token to retrieve the profile
//
// Documented endpoints:
//   Staging:    https://stg-id.uaepass.ae/idshub/{authorize,token,userinfo,logout}
//   Production: https://id.uaepass.ae/idshub/{authorize,token,userinfo,logout}
//
// IMPORTANT QUIRKS (per UAE Pass support + community implementations):
//   - The /token endpoint expects credentials via HTTP Basic auth
//     (Authorization: Basic base64(client_id:client_secret)), with
//     body as application/x-www-form-urlencoded. Their official docs at
//     one point suggested multipart/form-data — we use the spec-compliant
//     URL-encoded form, which works in staging and prod.
//   - Query parameters on /authorize must NOT be double-encoded — `qs`
//     handles this correctly with the default settings.
//   - The `acr_values` parameter controls auth strength. Use
//     'urn:safelayer:tws:policies:authentication:level:low' for first-time
//     SP onboarding, upgrade once approved by UAE Pass.

const axios = require('axios');
const qs = require('qs');
const crypto = require('crypto');
const config = require('../config');

const { endpoints, clientId, clientSecret, redirectUri, scope, acr } = config.uaepass;

function isConfigured() {
  return Boolean(clientId && clientSecret);
}

// PKCE is recommended even for confidential clients. We use S256.
function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function generateState() {
  return crypto.randomBytes(24).toString('base64url');
}

function buildAuthorizeUrl({ state, codeChallenge, locale = 'en' }) {
  const params = {
    response_type: 'code',
    client_id:     clientId,
    scope,
    state,
    redirect_uri:  redirectUri,
    acr_values:    acr,
    ui_locales:    locale,
  };
  if (codeChallenge) {
    params.code_challenge        = codeChallenge;
    params.code_challenge_method = 'S256';
  }
  return endpoints.authorize + '?' + qs.stringify(params, { encode: true });
}

async function exchangeCodeForToken({ code, codeVerifier }) {
  const body = {
    grant_type:   'authorization_code',
    code,
    redirect_uri: redirectUri,
  };
  if (codeVerifier) body.code_verifier = codeVerifier;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await axios.post(endpoints.token, qs.stringify(body), {
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      Authorization:   `Basic ${basic}`,
      Accept:          'application/json',
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    const err = new Error(`UAE Pass /token returned ${res.status}: ${JSON.stringify(res.data)}`);
    err.status = 502;
    err.code = 'UAEPASS_TOKEN_FAILED';
    err.publicMessage = 'Authentication exchange failed. Please try again.';
    throw err;
  }
  // Expected shape: { access_token, token_type: 'Bearer', expires_in, id_token?, scope }
  return res.data;
}

async function getUserInfo(accessToken) {
  const res = await axios.get(endpoints.userinfo, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:        'application/json',
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    const err = new Error(`UAE Pass /userinfo returned ${res.status}: ${JSON.stringify(res.data)}`);
    err.status = 502;
    err.code = 'UAEPASS_USERINFO_FAILED';
    err.publicMessage = 'Could not retrieve UAE Pass profile.';
    throw err;
  }
  // Expected fields on /userinfo (varies by scope and userType):
  //   sub, uuid, unifiedID, idn (Emirates ID), firstnameEN, lastnameEN,
  //   firstnameAR, lastnameAR, email, mobile, nationalityEN, nationalityAR,
  //   gender, dob, userType (SOP1=visitor, SOP2=email/mobile verified, SOP3=fully verified)
  return res.data;
}

function buildLogoutUrl(redirect) {
  return endpoints.logout + '?' + qs.stringify({ redirect_uri: redirect });
}

module.exports = {
  isConfigured,
  generatePkcePair,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  getUserInfo,
  buildLogoutUrl,
  endpoints,
};
