// Accessory for controlling Marantz AVR via HomeKit

var inherits = require('util').inherits;
var serialport = require("serialport");
var SerialPort = serialport.SerialPort; // localize object constructor
var Service, Characteristic;

// need to be global to be used in constructor
var maxVolume;
var minVolume;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    
    homebridge.registerAccessory("homebridge-marantz-rs232", "Marantz-RS232", MarantzAVR);
    
    
    function MarantzAVR(log, config) {
        // configuration
        this.name = config['name'];
        this.path = config['path'];
        maxVolume = config['maxVolume'];
        minVolume = config['minVolume'];
        
        this.log = log;
        
        this.serialPort = new SerialPort(this.path, {
                                        baudrate: 9600,
                                        parser: serialport.parsers.readline("\r")
                                        }, false); // this is the openImmediately flag [default is true]
    }
    
    // Custom Characteristics and service...
    MarantzAVR.AudioVolume = function() {
        Characteristic.call(this, 'Volume', '00001001-0000-1000-8000-135D67EC4377');
        console.log("Maximum Volume", maxVolume);
        this.setProps({
                      format: Characteristic.Formats.FLOAT,
                      maxValue: maxVolume,
                      minValue: minVolume,
                      minStep: 0.5,
                      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
                      });
        this.value = this.getDefaultValue();
    };
    inherits(MarantzAVR.AudioVolume, Characteristic);
    
    MarantzAVR.Muting = function() {
        Characteristic.call(this, 'Mute', '00001002-0000-1000-8000-135D67EC4377');
        this.setProps({
                      format: Characteristic.Formats.BOOL,
                      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
                      });
        this.value = this.getDefaultValue();
    };
    inherits(MarantzAVR.Muting, Characteristic);
    
    MarantzAVR.AudioDeviceService = function(displayName, subtype) {
        Service.call(this, displayName, '00000001-0000-1000-8000-135D67EC4377', subtype);
        this.addCharacteristic(MarantzAVR.AudioVolume);
        this.addCharacteristic(MarantzAVR.Muting);
    };
    inherits(MarantzAVR.AudioDeviceService, Service);
    
    MarantzAVR.prototype = {
        
    sendCommand: function(command, callback) {
        var that = this;
        
        that.serialPort.open(function (error) {
            if ( error ) {
                that.log('failed to open: '+error);
            } else {
                console.log('open');
                that.serialPort.on('data', function(data) {
                    that.serialPort.close(); // close after response
                    callback(data,0);
                });
                that.serialPort.write(command, function(err, results) {
                    that.serialPort.drain();
                    //callback(results,err);
                });
            }
        });
    },
        
    getPowerState: function(callback) {
        var cmd = "@PWR:?\r";
        
        this.sendCommand(cmd, function(response,error) {
                         
                         if (response === "@PWR:2\r") {
                         callback(null, true);
                         }
                         else {
                         callback(null, false);
                         }
                         this.log("Power state is:", response);
                         
                         }.bind(this))
        
    },
        
    setPowerState: function(powerOn, callback) {
        var cmd;
        
        if (powerOn) {
            cmd = "@PWR:2\r";
            this.log("Set", this.name, "to on");
        }
        else {
            cmd = "@PWR:1\r";
            this.log("Set", this.name, "to off");
        }
        
        this.sendCommand(cmd, function(response,error) {
                         if (error) {
                         this.log('Serial power function failed: %s');
                         callback(error);
                         }
                         else {
                         this.log('Serial power function succeeded!');
                         callback();
                         }
                         }.bind(this));
    },
        
    getMuteState: function(callback) {
        var cmd = "@AMT:?\r";
        
        this.sendCommand(cmd, function(error, response, body) {
                         
                         if (response === "@ATT:2\r") {
                         callback(null, true);
                         }
                         else {
                         callback(null, false);
                         }
                         this.log("Mute state is:", response);
                         
                         }.bind(this))
        
    },

    setMuteState: function(muteOn, callback) {
        var cmd;
        
        if (muteOn) {
            cmd = "@AMT:2\r";
            this.log(this.name, "muted");
        }
        else {
            cmd = "@AMT:1\r";
            this.log(this.name, "unmuted");
        }
        
        this.sendCommand(cmd, function(error, response, body) {
                         if (error) {
                         this.log('Serial mute function failed: %s');
                         callback(error);
                         }
                         else {
                         this.log('Serial mute function succeeded!');
                         callback();
                         }
                         }.bind(this));
    },
        
    getVolume: function(callback) {
        var cmd = "@VOL:?\r";
        
        this.sendCommand(cmd, function(error, response, body) {
                         
                         //VOL:xxxy(xxx)
                         if(response.indexOf("@VOL:") > -1) {
                            var vol = 0;
                            if(response.indexOf("+") > -1) vol = response.substring(6,2);
                            else vol = response.substring(5,2);
                         
                            callback(null, Number(vol));
                         }
                         else callback(null,0);
                         this.log("MasterVolume is:", response);
                         
                         }.bind(this))
        
    },
 
    setVolume: function(value, callback) {
        var cmd = "@VOL:0";
        if(value > 0) cmd = cmd + "+";
        cmd = cmd + value;
        
        this.sendCommand(cmd, "GET", function(error, response, body) {
                         if (error) {
                         this.log('Serial volume function failed: %s');
                         callback(error);
                         }
                         else {
                         this.log("Set volume to", value, "db");
                         callback();
                         }
                         }.bind(this));
    },

    getServices: function() {
        var that = this;
        
        var informationService = new Service.AccessoryInformation();
        informationService
        .setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.Manufacturer, "Marantz")
        .setCharacteristic(Characteristic.Model, "SR5004")
        .setCharacteristic(Characteristic.SerialNumber, "1234567890");
        
        var switchService = new Service.Switch("Power State");
        switchService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getPowerState.bind(this))
        .on('set', this.setPowerState.bind(this));

        var audioDeviceServie = new MarantzAVR.AudioDeviceService("Audio Functions");
        audioDeviceServie
        .getCharacteristic(MarantzAVR.Muting)
        .on('get', this.getMuteState.bind(this))
        .on('set', this.setMuteState.bind(this));
        
        audioDeviceServie
        .getCharacteristic(MarantzAVR.AudioVolume)
        .on('get', this.getVolume.bind(this))
        .on('set', this.setVolume.bind(this));

        return [informationService, switchService, audioDeviceServie];
    }
    }
}