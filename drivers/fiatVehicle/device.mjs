'use strict';

import Homey from 'homey';
import {
	cognitoCredentialsStillValid,
	executeRemoteAction,
	fetchVehicleStatus,
	pinTokenStillValid,
	twoFactorPinAuthenticate,
	userLogin,
	userRetrieveCognitoCredentials,
} from '../../api/FiatUConnectApi.mjs';

const pollingInterval = 10 * 60 * 1000;
const batteryAlarmLevel = 20;
export default class FiatVehicle extends Homey.Device {

	poller = null;

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit() {
		this.log('Device init');
		this.log('Name:', this.getName());
		this.log('Class:', this.getClass());
		this.log('VIN:', this.getData().id);

		await this.updateAvailableCapabilitiesOnInit();

		this.registerRemoteActions();
		this.registerFlowActionCards();

		this.poller = this.homey.setInterval(
			this.updateCapabilitiesWithVehicleStatus.bind(this),
			pollingInterval,
		);
		await this.updateCapabilitiesWithVehicleStatus();
	}

	registerRemoteActions() {
		[
			['fiat_vehicle_action_hvac', 'hvac'],
			['fiat_vehicle_action_lock', 'lock'],
			['fiat_vehicle_action_unlock', 'unlock'],
		].forEach(([capability, action]) => {
			this.registerCapabilityListener(
				capability,
				async (value) => {
					if (value !== true) {
						this.log('value not supported for this capability');
						return;
					}

					await this.doRemoteAction(action);
				},
			);
		});
	}

	registerFlowActionCards() {
		[
			['fiat_vehicle_flow_action_hvac', 'hvac'],
			['fiat_vehicle_flow_action_lock', 'lock'],
			['fiat_vehicle_flow_action_unlock', 'unlock'],
		].forEach(([actionCardId, action]) => {
			const hvacFlow = this.homey.flow.getActionCard(actionCardId);
			hvacFlow.registerRunListener(async () => {
				await this.doRemoteAction(action);
			});
		});
	}

	doRemoteAction = async (action) => {
		const vin = this.getData().id;
		const uid = this.getStoreValue('uid');
		const cognitoCredentials = await this.retrieveValidCognitoCredentials();
		const pinToken = await this.retrieveValidPinToken(cognitoCredentials, uid);

		let command = null;

		switch (action) {
		case 'lock':
			command = 'RDL';// Lock doors
			break;
		case 'unlock':
			command = 'RDU';// Unlock doors
			break;
		case 'hvac':
			command = 'ROPRECOND';// Turn on HVAC
			break;
		default:
			return;
		}

		await executeRemoteAction(
			uid,
			vin,
			cognitoCredentials,
			pinToken,
			command,
		);
	};

	async updateAvailableCapabilitiesOnInit() {
		const driverCapabilities = this.driver.manifest.capabilities;

		for (const currentCapability of this.getCapabilities()) {
			if (!driverCapabilities.includes(currentCapability)) {
				await this.removeCapability(currentCapability);
			}
		}

		for (const capability of driverCapabilities) {
			if (!this.hasCapability(capability)) {
				this.log(`Add new capability: ${capability}`);
				await this.addCapability(capability);
			}
		}
	}

	async updateCapabilitiesWithVehicleStatus() {
		const vin = this.getData().id;
		const uid = this.getStoreValue('uid');
		const cognitoCredentials = await this.retrieveValidCognitoCredentials();

		const vehicleStatus = await fetchVehicleStatus(uid, cognitoCredentials, vin);

		this.log('Last status at:', (new Date(vehicleStatus.timestamp)).toString());

		const { battery } = vehicleStatus.evInfo;

		await Promise.all([
			this.setCapabilityValue(
				'measure_battery',
				battery.stateOfCharge,
			),
			this.setCapabilityValue(
				'alarm_battery',
				battery.stateOfCharge <= batteryAlarmLevel,
			),
			this.setCapabilityValue(
				'battery_charging_state',
				this.convertChartingStatusToChartingState(battery.chargingStatus),
			),
			this.setCapabilityValue(
				'fiat_vehicle_state_plugged_in',
				battery.plugInStatus,
			),
			this.setCapabilityValue(
				'fiat_vehicle_measurement_distance_to_empty',
				Math.round(vehicleStatus.vehicleInfo.fuel.distanceToEmpty.value),
			),
			this.setCapabilityValue(
				'fiat_vehicle_measurement_distance_to_service',
				parseFloat(vehicleStatus.vehicleInfo.distanceToService.distanceToService.value),
			),
			this.setCapabilityValue(
				'fiat_vehicle_measurement_odometer',
				Math.round(vehicleStatus.vehicleInfo.odometer.odometer.value),
			),
			this.setCapabilityValue(
				'fiat_vehicle_measurement_time_to_fully_charge_l2',
				battery.timeToFullyChargeL2,
			),
			this.setCapabilityValue(
				'fiat_vehicle_measurement_time_to_fully_charge_l3',
				battery.timeToFullyChargeL3,
			),
		]);
	}

	convertChartingStatusToChartingState(chargingStatus) {
		if (chargingStatus === 'CHARGING') {
			return 'charging';
		}
		if (chargingStatus === 'UNKNOWN') {
			return 'discharging';
		}
		return 'idle';
	}

	async retrieveValidCognitoCredentials() {
		let cognitoCredentials = this.getStoreValue('cognitoCredentials');

		if (!cognitoCredentialsStillValid(cognitoCredentials)) {
			this.log('Credentials expired, refreshing');

			const username = this.getSetting('username');
			const password = this.getSetting('password');

			cognitoCredentials = await this.refreshLogin(username, password);
		}
		return cognitoCredentials;
	}

	async refreshLogin(username, password) {
		const loginResponse = await userLogin(username, password);
		const cognitoCredentials = await userRetrieveCognitoCredentials(loginResponse.jwt);

		await this.setStoreValue('cognitoCredentials', cognitoCredentials);

		return cognitoCredentials;
	}

	async retrieveValidPinToken(cognitoCredentials, uid) {
		let pinToken = this.getStoreValue('pinToken');
		const pinExpiry = this.getStoreValue('pinExpiry');

		if (!pinTokenStillValid(pinExpiry)) {
			this.log('2FA Token expired, refreshing');

			const pin = this.getSetting('pin');

			pinToken = this.refreshTwoFactorToken(cognitoCredentials, uid, pin);
		}

		return pinToken;
	}

	async refreshTwoFactorToken(cognitoCredentials, uid, pin) {
		const [pinToken, pinExpiry] = await twoFactorPinAuthenticate(cognitoCredentials, uid, pin);

		await this.setStoreValue('pinToken', pinToken);
		await this.setStoreValue('pinExpiry', pinExpiry);

		return pinToken;
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded() {
		this.log('FiatVehicle has been added');
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings({
		oldSettings,
		newSettings,
		changedKeys,
	}) {
		let loginChanged = false;
		let pinChanged = false;

		for (const key of changedKeys) {
			if (key === 'username') {
				loginChanged = true;
			} else if (key === 'password') {
				loginChanged = true;
			} else if (key === 'pin') {
				pinChanged = true;
			}
		}

		if (!loginChanged && !pinChanged) {
			return;
		}

		const uid = this.getStoreValue('uid');
		let cognitoCredentials = await this.retrieveValidCognitoCredentials();

		if (loginChanged) {
			try {
				cognitoCredentials = await this.refreshLogin(newSettings.username, newSettings.password);
				this.log('New login is correct');
			} catch (e) {
				this.log('New login is incorrect');
				throw new Error('Incorrect PIN');
			}
		}

		if (pinChanged) {
			try {
				await this.refreshTwoFactorToken(cognitoCredentials, uid, newSettings.pin);
				this.log('New PIN is correct');
			} catch (e) {
				this.log('New PIN is incorrect');
				throw new Error('Incorrect PIN');
			}
		}
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name) {
		this.log(`FiatVehicle was renamed to ${name}`);
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted() {
		if (this.poller) {
			this.homey.clearInterval(this.poller);
		}

		this.log('FiatVehicle has been deleted');
	}

}
