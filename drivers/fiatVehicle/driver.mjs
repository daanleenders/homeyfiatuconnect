'use strict';

import Homey from 'homey';
import {
	fetchVehicles, twoFactorPinAuthenticate, userLogin, userRetrieveCognitoCredentials,
} from '../../api/FiatUConnectApi.mjs';

export default class FiatDriver extends Homey.Driver {

	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit() {
		this.log('FiatDriver has been initialized');
	}

	async onPair(session) {
		let username = '';
		let password = '';
		let pin = '';
		let uid = '';
		let cognitoCredentials = {};
		let pinToken = '';
		let pinExpiry = 0;

		session.setHandler('login', async (data) => {
			username = data.username;
			password = data.password;

			let credentialsAreValid = false;

			const loginResponse = await userLogin(username, password);

			if (!loginResponse.isRegistered || !loginResponse.isVerified || !loginResponse.isActive) {
				throw new Error('The account isn\'t registered, verified or active. Resolve this in the Fiat app and try again.');
			}

			uid = loginResponse.uid;

			cognitoCredentials = await userRetrieveCognitoCredentials(loginResponse.jwt);
			this.log(uid);
			this.log(cognitoCredentials);

			if (uid.length > 0 && cognitoCredentials.Expiration > Math.floor(+new Date() / 1000)) {
				credentialsAreValid = true;
			}

			// return true to continue adding the device if the login succeeded
			// return false to indicate to the user the login attempt failed
			// thrown errors will also be shown to the user
			return credentialsAreValid;
		});

		session.setHandler('pincode', async (pincode) => {
			pin = pincode.join('');

			try {
				[pinToken, pinExpiry] = await twoFactorPinAuthenticate(cognitoCredentials, uid, pin);
			} catch (e) {
				return false;
			}

			this.log(pinToken, pinExpiry);

			return true;
		});

		session.setHandler('list_devices', async () => {
			const vehicles = await fetchVehicles(uid, cognitoCredentials);

			this.log(`${vehicles.length} vehicles found.`);

			return vehicles.map((vehicle) => {
				let name = `${vehicle.make} ${vehicle.modelDescription}`;
				if (vehicle.nickname.length > 0) {
					name = vehicle.nickname;
				} else if (vehicle.subMake !== vehicle.make) {
					name = `${vehicle.subMake} ${vehicle.modelDescription}`;
				}

				return {
					name,
					data: {
						id: vehicle.vin,
					},
					store: {
						uid,
						cognitoCredentials,
						pinToken,
						pinExpiry,
						make: vehicle.make,
						submake: vehicle.submake,
						modelDescription: vehicle.modelDescription,
						fuelType: vehicle.fuelType,
					},
					settings: {
						username,
						password,
						pin,
					},
				};
			});
		});
	}

}
