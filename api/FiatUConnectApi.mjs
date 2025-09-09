'use strict';

import { CookieJar, fetch as cookieFetch } from 'node-fetch-cookies';
import { createHash } from 'crypto';
import { createSignedFetcher } from 'aws-sigv4-fetch';

const UCONNECT_LOGIN_API_KEY = '3_mOx_J2dRgjXYCdyhchv3b5lhi54eBcdCTX4BI8MORqmZCoQWhA0mV2PTlptLGUQI';
const UCONNECT_LOGIN_BASE = 'https://loginmyuconnect.fiat.com';
const UCONNECT_LOOGIN_EXPIRATION = 600_000; // 10 minutes

const AWS_API_KEY = 'qLYupk65UU1tw2Ih1cJhs4izijgRDbir2UFHA3Je';
const AWS_REGION = 'eu-west-1';

const UCONNECT_API_BASE = 'https://channels.sdpr-01.fcagcv.com';
const UCONNECT_API_DEFAULT_HEADERS = {
	'Content-Type': 'application/json',
	Accept: 'application/json',
	Locale: 'nl_nl',
	'X-originator-type': 'web',
	'X-ClientApp-Version': '1.0',
	'X-Api-Key': AWS_API_KEY,
};

const TWOFA_API_BASE = 'https://mfa.fcl-01.fcagcv.com';
const TWOFA_API_KEY = 'JWRYW7IYhW9v0RqDghQSx4UcRYRILNmc8zAuh5ys';

async function bootstrapWebLogin(cookieJar) {
	const urlParams = new URLSearchParams({
		apiKey: UCONNECT_LOGIN_API_KEY,
	});
	await cookieFetch(
		cookieJar,
		`${UCONNECT_LOGIN_BASE}/accounts.webSdkBootstrap?${urlParams.toString()}`,
		{
			method: 'GET',
		},
	);
}

async function exchangeLoginTokenForGigyaJWT(cookieJar, token) {
	const urlParams = new URLSearchParams({
		APIKey: UCONNECT_LOGIN_API_KEY,
		login_token: token,
		fields: 'profile.firstName,profile.lastName,profile.email,country,locale,data.disclaimerCodeGSDP',
	});

	const response = await cookieFetch(
		cookieJar,
		`${UCONNECT_LOGIN_BASE}/accounts.getJWT?${urlParams.toString()}`,
	);

	const data = await response.json();

	if (data.statusCode !== 200) {
		throw new Error(data.errorDetails);
	}

	return data.id_token;
}

export async function userLogin(username, password) {
	const cookieJar = new CookieJar();

	await bootstrapWebLogin(cookieJar);

	const response = await cookieFetch(
		cookieJar,
		`${UCONNECT_LOGIN_BASE}/accounts.login`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: (new URLSearchParams({
				loginId: username,
				password,
				sessionExpiration: UCONNECT_LOOGIN_EXPIRATION,
				apiKey: UCONNECT_LOGIN_API_KEY,
				targetEnv: 'jssdk',
			})).toString(),
		},
	);

	const data = await response.json();

	if (data.statusCode !== 200) {
		throw new Error(data.errorDetails);
	}

	const jwt = await exchangeLoginTokenForGigyaJWT(cookieJar, data.sessionInfo.login_token);

	return {
		uid: data.UID,
		token: data.sessionInfo.login_token,
		jwt,
		isActive: data.isActive,
		isRegistered: data.isRegistered,
		isVerified: data.isVerified,
	};
}

async function generateClientRequestId() {
	return createHash('sha256')
		.update(Math.random()
			.toString(36))
		.digest('hex')
		.slice(0, 16);
}

async function exchangeGigyaJWTForCognitoToken(jwt) {
	const response = await fetch(
		'https://authz.sdpr-01.fcagcv.com/v2/cognito/identity/token',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': AWS_API_KEY,
				'x-clientapp-version': '1.0',
				'x-originator-type': 'web',
				'x-clientapp-name': 'CWP',
				clientrequestid: await generateClientRequestId(),
			},
			body: JSON.stringify({
				gigya_token: jwt,
			}),
		},
	);

	const data = await response.json();

	if (response.status !== 200) {
		throw new Error(data.message);
	}

	return data;
}

export async function userRetrieveCognitoCredentials(jwt) {
	const cognitoToken = await exchangeGigyaJWTForCognitoToken(jwt);

	const response = await fetch(
		`https://cognito-identity.${AWS_REGION}.amazonaws.com/`,
		{
			method: 'POST',
			headers: {
				'Content-Type': ' application/x-amz-json-1.1',
				'X-AMZ-TARGET': 'com.amazonaws.cognito.identity.model.AWSCognitoIdentityService.GetCredentialsForIdentity',
			},
			body: JSON.stringify({
				IdentityId: cognitoToken.IdentityId,
				Logins: {
					'cognito-identity.amazonaws.com': cognitoToken.Token,
				},
			}),
		},
	);

	const data = await response.json();

	if (response.status !== 200) {
		throw new Error(data.message);
	}

	return data.Credentials;
}

function createAwsFetch(cognitoCredentials) {
	return createSignedFetcher({
		service: 'execute-api',
		region: 'eu-west-1',
		credentials: {
			accessKeyId: cognitoCredentials.AccessKeyId,
			secretAccessKey: cognitoCredentials.SecretKey,
			sessionToken: cognitoCredentials.SessionToken,
		},
		fetch,
	});
}

export async function twoFactorPinAuthenticate(cognitoCredentials, uid, pincode) {
	const fetch = createAwsFetch(cognitoCredentials);

	const response = await fetch(
		`${TWOFA_API_BASE}/v1/accounts/${uid}/ignite/pin/authenticate`,
		{
			method: 'POST',
			headers: {
				...UCONNECT_API_DEFAULT_HEADERS,
				clientrequestid: await generateClientRequestId(),
				'X-Api-Key': TWOFA_API_KEY,
			},
			body: JSON.stringify({
				pin: Buffer.from(pincode).toString('base64'),
			}),
		},
	);

	const data = await response.json();

	if (response.status !== 200) {
		throw new Error(data.message);
	}

	/**
	 * Set timestamp for when the token expires.
	 * We remove 3 seconds to prevent the token being valid on checking but invalid when you use it.
	 */
	const expiryTimestamp = Date.now().valueOf() + data.expiry - 3_000;

	return [
		data.token,
		expiryTimestamp,
	];
}

export function cognitoCredentialsStillValid(cognitoCredentials) {
	return cognitoCredentials?.Expiration > (Date.now().valueOf() / 1000);
}

export function pinTokenStillValid(pinExpiry) {
	return pinExpiry > Date.now().valueOf();
}

export async function fetchVehicles(uid, cognitoCredentials) {
	const fetch = createAwsFetch(cognitoCredentials);

	const response = await fetch(
		`${UCONNECT_API_BASE}/v4/accounts/${uid}/vehicles?stage=ALL`,
		{
			method: 'GET',
			headers: {
				...UCONNECT_API_DEFAULT_HEADERS,
				clientrequestid: await generateClientRequestId(),
			},
		},
	);

	const data = await response.json();

	if (response.status !== 200) {
		throw new Error(data.message);
	}

	return data.vehicles;
}

export async function fetchVehicleStatus(uid, cognitoCredentials, vin) {
	const fetch = createAwsFetch(cognitoCredentials);

	const response = await fetch(
		`${UCONNECT_API_BASE}/v4/accounts/${uid}/vehicles/${vin}/status`,
		{
			method: 'GET',
			headers: {
				...UCONNECT_API_DEFAULT_HEADERS,
				clientrequestid: await generateClientRequestId(),
			},
		},
	);

	const data = await response.json();

	if (response.status !== 200) {
		throw new Error(data.message);
	}

	return data;
}

export async function fetchVehicleLocation(uid, cognitoCredentials, vin) {
	const fetch = createAwsFetch(cognitoCredentials);

	const response = await fetch(
		`${UCONNECT_API_BASE}/v1/accounts/${uid}/vehicles/${vin}/location/lastknown`,
		{
			method: 'GET',
			headers: {
				...UCONNECT_API_DEFAULT_HEADERS,
				clientrequestid: await generateClientRequestId(),
			},
		},
	);

	const data = await response.json();

	if (response.status !== 200) {
		throw new Error(data.message);
	}

	return data;
}

export async function executeRemoteAction(uid, vin, cognitoCredentials, pinToken, command) {
	const fetch = createAwsFetch(cognitoCredentials);

	const response = await fetch(
		`${UCONNECT_API_BASE}/v1/accounts/${uid}/vehicles/${vin}/remote`,
		{
			method: 'POST',
			headers: {
				...UCONNECT_API_DEFAULT_HEADERS,
				clientrequestid: await generateClientRequestId(),
			},
			body: JSON.stringify({
				command,
				pinAuth: pinToken,
			}),
		},
	);

	const data = await response.json();

	if (response.status !== 200) {
		throw new Error(`FIAT API ERROR: ${data.message}`);
	}

	return data;
}
