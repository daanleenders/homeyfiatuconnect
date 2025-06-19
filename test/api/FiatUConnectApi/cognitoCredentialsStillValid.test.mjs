'use strict';

// eslint-disable-next-line no-redeclare
import { jest } from '@jest/globals';
import {
	cognitoCredentialsStillValid,
} from '../../../src/api/FiatUConnectApi.mjs';

beforeAll(() => {
	jest.useFakeTimers().setSystemTime(new Date(2025, 5, 16, 15, 15, 10, 0));
});

afterAll(() => {
	jest.useRealTimers();
});

it.each([
	{ name: 'has 7 seconds left', expiry: new Date(2025, 5, 16, 15, 15, 17, 0).valueOf() },
	{ name: 'has 4 minutes left', expiry: new Date(2025, 5, 16, 15, 19, 10, 0).valueOf() },
	{ name: 'has 1 hour left', expiry: new Date(2025, 5, 16, 16, 15, 10, 0).valueOf() },
])(
	'should still be valid when expiry $name',
	({ expiry }) => {
		const fakeCognitoCredentials = {
			AccessKeyId: 'TW8N4ZK2NKO2AFNAPKGP',
			SecretKey: 'rhGWb9fwjJFVXAmgYnXaLAX67Xzzm789YsvTXjTP',
			SessionToken: 'SzhMa2hNcDJKenhROXFndVVjTHdlbUdmWk42TFRWWDc2cUN2ZlF3VllyeWdXTm11OHRwbTdqVVJ4ZGtLc2RXdUFMSkhXcTlEdExSNjY0VWY2ZHNVano5NHUzbjNLOUdpczkyaQ==',
			Expiration: Math.floor(expiry / 1000),
		};
		expect(cognitoCredentialsStillValid(fakeCognitoCredentials)).toBe(true);
	},
);

it.each([
	{ name: 'is exactly now', expiry: new Date(2025, 5, 16, 15, 15, 10, 0).valueOf() },
	{ name: 'was 1 millisecond ago', expiry: new Date(2025, 5, 16, 15, 15, 9, 999).valueOf() },
	{ name: 'was 158 millisecond left', expiry: new Date(2025, 5, 16, 15, 15, 9, 842).valueOf() },
	{ name: 'was 3 seconds ago', expiry: new Date(2025, 5, 16, 15, 15, 7, 0).valueOf() },
	{ name: 'was 7 minutes ago', expiry: new Date(2025, 5, 16, 15, 8, 10, 0).valueOf() },
	{ name: 'was 1 hour ago', expiry: new Date(2025, 5, 16, 14, 15, 10, 0).valueOf() },
	{ name: 'has 1 millisecond left', expiry: new Date(2025, 5, 16, 15, 15, 10, 1).valueOf() },
	{ name: 'has 134 millisecond left', expiry: new Date(2025, 5, 16, 15, 15, 10, 134).valueOf() },
])(
	'should NOT be valid when expiry $name',
	({ expiry }) => {
		const fakeCognitoCredentials = {
			AccessKeyId: 'TW8N4ZK2NKO2AFNAPKGP',
			SecretKey: 'rhGWb9fwjJFVXAmgYnXaLAX67Xzzm789YsvTXjTP',
			SessionToken: 'SzhMa2hNcDJKenhROXFndVVjTHdlbUdmWk42TFRWWDc2cUN2ZlF3VllyeWdXTm11OHRwbTdqVVJ4ZGtLc2RXdUFMSkhXcTlEdExSNjY0VWY2ZHNVano5NHUzbjNLOUdpczkyaQ==',
			Expiration: Math.floor(expiry / 1000),
		};
		expect(cognitoCredentialsStillValid(fakeCognitoCredentials)).toBe(false);
	},
);
