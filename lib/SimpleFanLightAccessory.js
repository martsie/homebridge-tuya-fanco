const BaseAccessory = require('./BaseAccessory');

class SimpleFanLightAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.FANLIGHT;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;
        this.accessory.addService(Service.Fan, this.device.context.name);
        this.accessory.addService(Service.Lightbulb, this.device.context.name + " Light");
        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        this.log.info(dps);

        const {Service, Characteristic, AdaptiveLightingController} = this.hap;
        const serviceFan = this.accessory.getService(Service.Fan);
        const serviceLightbulb = this.accessory.getService(Service.Lightbulb);
        this._checkServiceName(serviceFan, this.device.context.name);
        this._checkServiceName(serviceLightbulb, this.device.context.name + " Light");
        this.dpFanOn = this._getCustomDP(this.device.context.dpFanOn) || '1';
        this.dpRotationSpeed = this._getCustomDP(this.device.context.dpRotationSpeed) || '3';
        this.dpLightOn = this._getCustomDP(this.device.context.dpLightOn) || '9';
        this.dpBrightness = this._getCustomDP(this.device.context.dpBrightness) || '10';
        this.useLight = this._coerceBoolean(this.device.context.useLight, true);
        this.useBrightness = this._coerceBoolean(this.device.context.useBrightness, true);
        this.maxSpeed = parseInt(this.device.context.maxSpeed) || 8;
        // This variable is here so that we can set the fans to turn onto speed one instead of 3 on start.
        this.fanDefaultSpeed = parseInt(this.device.context.fanDefaultSpeed) || 1;
        // This variable is here as a workaround to allow for the on/off function to work.
        this.fanCurrentSpeed = 0;
        // Add setting to use .toString() on return values or not.
        this.useStrings = this._coerceBoolean(this.device.context.useStrings, true);
		this.dpColorTemperature = this._getCustomDP(this.device.context.dpColorTemperature) || '17';

        const characteristicFanOn = serviceFan.getCharacteristic(Characteristic.On)
            .updateValue(this._getFanOn(dps[this.dpFanOn]))
            .on('get', this.getFanOn.bind(this))
            .on('set', this.setFanOn.bind(this));

        const characteristicRotationSpeed = serviceFan.getCharacteristic(Characteristic.RotationSpeed)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: Math.max(100 / this.maxSpeed)
            })
            .updateValue(this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]))
            .on('get', this.getSpeed.bind(this))
            .on('set', this.setSpeed.bind(this));

		const characteristicLightOn = serviceLightbulb.getCharacteristic(Characteristic.On)
                .updateValue(this._getLightOn(dps[this.dpLightOn]))
                .on('get', this.getLightOn.bind(this))
                .on('set', this.setLightOn.bind(this));

		const characteristicBrightness = serviceLightbulb.getCharacteristic(Characteristic.Brightness)
            .updateValue(this.convertBrightnessFromTuyaToHomeKit(dps[this.dpBrightness]))
            .on('get', this.getBrightness.bind(this))
            .on('set', this.setBrightness.bind(this));
			
		const characteristicColorTemperature = serviceLightbulb.getCharacteristic(Characteristic.ColorTemperature)
			.setProps({
				minValue: 0,
				maxValue: 710
			})
			.updateValue(this.convertColorTemperatureFromTuyaToHomeKit(dps[this.dpColorTemperature]))
				.on('get', this.getColorTemperature.bind(this))
				.on('set', this.setColorTemperature.bind(this));

		this.characteristicColorTemperature = characteristicColorTemperature;

		if (this.adaptiveLightingSupport()) {
			this.adaptiveLightingController = new AdaptiveLightingController(serviceLightbulb);
			this.accessory.configureController(this.adaptiveLightingController);
			this.accessory.adaptiveLightingController = this.adaptiveLightingController;
		}

        this.device.on('change', (changes, state) => {
			this.log.info(state);
			this.log.info(changes);
            if (changes.hasOwnProperty(this.dpFanOn) && characteristicFanOn.value !== changes[this.dpFanOn])
                characteristicFanOn.updateValue(changes[this.dpFanOn]);

            if (changes.hasOwnProperty(this.dpRotationSpeed) && this.convertRotationSpeedFromHomeKitToTuya(characteristicRotationSpeed.value) !== changes[this.dpRotationSpeed])
                characteristicRotationSpeed.updateValue(this.convertRotationSpeedFromTuyaToHomeKit(changes[this.dpRotationSpeed]));

            if (changes.hasOwnProperty(this.dpLightOn) && characteristicLightOn && characteristicLightOn.value !== changes[this.dpLightOn])
                characteristicLightOn.updateValue(changes[this.dpLightOn]);

           
            if (changes.hasOwnProperty(this.dpBrightness) && this.convertBrightnessFromHomeKitToTuya(characteristicBrightness.value) !== changes[this.dpBrightness])
                characteristicBrightness.updateValue(this.convertBrightnessFromTuyaToHomeKit(changes[this.dpBrightness]));


			if (changes.hasOwnProperty(this.dpColorTemperature)) {
                if (this.convertColorTemperatureFromHomeKitToTuya(characteristicColorTemperature.value) !== changes[this.dpColorTemperature])
                    characteristicColorTemperature.updateValue(this.convertColorTemperatureFromTuyaToHomeKit(changes[this.dpColorTemperature]));
            } else if (changes[this.dpBrightness]) {
                characteristicColorTemperature.updateValue(this.convertColorTemperatureFromTuyaToHomeKit(state[this.dpColorTemperature]));
            }

            this.log.debug('SimpleFanLight changed: ' + JSON.stringify(state));
        });
    }

    /*************************** FAN ***************************/
    // Get the Current Fan State
    getFanOn(callback) {
        this.getState(this.dpFanOn, (err, dp) => {
            if (err) return callback(err);
            callback(null, this._getFanOn(dp));
        });
    }

    _getFanOn(dp) {
        const {Characteristic} = this.hap;
        return dp;
    }

    setFanOn(value, callback) {
        const {Characteristic} = this.hap;
        // This uses the multistatelegacy set command to send the fan on and speed request in one call.
        if (value == false ) {
          this.fanCurrentSpeed = 0;
          // This will turn off the fan speed if it is set to be 0.
          return this.setState(this.dpFanOn, false, callback);
        } else {
          if (this.fanCurrentSpeed === 0) {
            // The current fanDefaultSpeed Variable is there to have the fan set to a sensible default if turned on.
            if (this.useStrings) {
                return this.setMultiStateLegacy({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanDefaultSpeed.toString()}, callback);
            } else {
                return this.setMultiStateLegacy({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanDefaultSpeed}, callback);
            }
          } else {
            // The current fanCurrentSpeed Variable is there to ensure the fan speed doesn't change if the fan is already on.
            if (this.useStrings) {
                return this.setMultiStateLegacy({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanCurrentSpeed.toString()}, callback);
            } else {
                return this.setMultiStateLegacy({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanCurrentSpeed}, callback);
            }
          }
        }
        callback();
    }

    // Get the Current Fan Speed
    getSpeed(callback) {
        this.getState(this.dpRotationSpeed, (err, dp) => {
            if (err) return callback(err);
            callback(null, this.convertRotationSpeedFromTuyaToHomeKit(this.device.state[this.dpRotationSpeed]));
        });
    }

    // Set the new fan speed
    setSpeed(value, callback) {
      const {Characteristic} = this.hap;
      if (value === 0) {
        // This is to set the fan speed variable to be 1 when the fan is off.
        if (this.useStrings) {
            return this.setMultiStateLegacy({[this.dpFanOn]: false, [this.dpRotationSpeed]: this.fanDefaultSpeed.toString()}, callback);
        } else {
            return this.setMultiStateLegacy({[this.dpFanOn]: false, [this.dpRotationSpeed]: this.fanDefaultSpeed}, callback);
        }
      } else {
        // This is to set the fan speed variable to match the current speed.
        this.fanCurrentSpeed = this.convertRotationSpeedFromHomeKitToTuya(value);
        // This uses the multistatelegacy set command to send the fan on and speed request in one call.
        if (this.useStrings) {
            return this.setMultiStateLegacy({[this.dpFanOn]: true, [this.dpRotationSpeed]: this.convertRotationSpeedFromHomeKitToTuya(value).toString()}, callback);
        } else {
            return this.setMultiStateLegacy({[this.dpFanOn]: true, [this.dpRotationSpeed]: this.convertRotationSpeedFromHomeKitToTuya(value)}, callback);            
        }
      }
      callback();
    }

    /*************************** LIGHT ***************************/
    //Lightbulb State
    getLightOn(callback) {
        this.getState(this.dpLightOn, (err, dp) => {
            if (err) return callback(err);
            callback(null, this._getLightOn(dp));
        });
    }

    _getLightOn(dp) {
        const {Characteristic} = this.hap;
        return dp;
    }

    setLightOn(value, callback) {
        const {Characteristic} = this.hap;
        return this.setState(this.dpLightOn, value, callback);
        callback();
    }

    //Lightbulb Brightness
	getBrightness(callback) {
        return callback(null, this.convertBrightnessFromTuyaToHomeKit(this.device.state[this.dpBrightness]));
    }

    setBrightness(value, callback) {
        return this.setState(this.dpBrightness, this.convertBrightnessFromHomeKitToTuya(value), callback);
    }

	getColorTemperature(callback) {
        callback(null, this.convertColorTemperatureFromTuyaToHomeKit(this.device.state[this.dpColorTemperature]));
    }

    setColorTemperature(value, callback) {
        if (value === 0) return callback(null, true);

        this.setState(this.dpColorTemperature, this.convertColorTemperatureFromHomeKitToTuya(value), callback);
    }
}

module.exports = SimpleFanLightAccessory;
