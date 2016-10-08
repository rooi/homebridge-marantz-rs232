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
        
        this.timeout = config.timeout || 1000;
        this.queue = [];
        this.ready = true;
        
        this.log = log;
        
        this.volume = minVolume;
        
        this.serialPort = new SerialPort(this.path, {
                                        baudrate: 9600,
                                        parser: serialport.parsers.readline("\r"),
                                         autoOpen: false
                                        }); // this is the openImmediately flag [default is true]
    }
    
    // Custom Characteristics and service...
    MarantzAVR.AudioVolume = function() {
        Characteristic.call(this, 'Volume', '00001001-0000-1000-8000-135D67EC4377');
        console.log("Maximum Volume", maxVolume);
        this.setProps({
                      format: Characteristic.Formats.FLOAT,
                      maxValue: maxVolume,
                      minValue: minVolume,
                      minStep: 1.0,
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
        
    send: function(cmd, callback) {
        this.sendCommand(cmd, callback);
        //if (callback) callback();
    },
        
    exec: function() {
        // Check if the queue has a reasonable size
        if(this.queue.length > 5) this.queue.clear();
            
        this.queue.push(arguments);
        this.process();
    },
        
    sendCommand: function(command, callback) {
        var that = this;
        
        //if(that.serialPort.isOpen()) that.serialPort.close();
        that.serialPort.open(function (error) {
            if ( error ) {
                that.log('failed to open: '+error);
                if(callback) callback(0,1);
            } else {
                console.log('open and write command ' + command);
                that.serialPort.on('data', function(data) {
                    if(that.serialPort.isOpen()) that.serialPort.close(); // close after response
                    if(callback) callback(data,0);
                });
                that.serialPort.write(command, function(err, results) {
                    that.serialPort.drain();
                                      
                    //setTimeout(function () {
                    //    if(that.serialPort.isOpen()) that.serialPort.close(); // close after response
                    //    //callback(0,0);
                    //}, 1000);
                    //callback(results,err);
                });
            }
        });
    },
        
    process: function() {
        if (this.queue.length === 0) return;
        if (!this.ready) return;
        var self = this;
        this.ready = false;
        this.send.apply(this, this.queue.shift());
        setTimeout(function () {
                    self.ready = true;
                    self.process();
                    }, this.timeout);
    },
        
    getPowerState: function(callback) {
        var cmd = "@PWR:?\r";
        
        console.log("getPowerState");
        
        this.exec(cmd, function(response,error) {
                  
            this.log("Power state is: " + response);
            if (response && response.indexOf("@PWR:2") > -1) {
                if(callback) callback(null, true);
            }
            else {
                if(callback) callback(null, false);
            }
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
        
        this.exec(cmd, function(response,error) {
            if (error) {
                this.log('Serial power function failed: %s');
                if(callback) callback(error);
            }
            else {
                this.log('Serial power function succeeded!');
                if(callback) callback();
            }
        }.bind(this));
    },

    getMuteState: function(callback) {
        var cmd = "@AMT:?\r";
        
        this.exec(cmd, function(response, error) {
             
            this.log("Mute state is:", response);
            if (response && response.indexOf("@ATT:2") > -1) {
                callback(null, true);
            }
            else {
                callback(null, false);
            }
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
        
        this.exec(cmd, function(response, error) {
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
        
        this.exec(cmd, function(response, error) {
                         
                         //VOL:xxxy(xxx)
            this.log("MasterVolume is:", response);
            if(response && response.indexOf("@VOL:") > -1) {
                console.log("response.indexOf(\"@VOL:\") > -1");
                var vol = 0;
                if(response.indexOf("+") > -1) {
                    console.log("+");
                    vol = response.substring(6,8);
                }
                else {
                    console.log("-");
                    vol = response.substring(5,8);
                }
                this.volume = Number(vol);
                console.log("vol=" + vol);
                callback(null, Number(vol));
            }
            else callback(null,0);
        }.bind(this))
    },
 
    setVolume: function(value, callback) {
        
        if(this.volume != value) {
            this.volume = value;
            var cmd = "@VOL:0";
            if(value > 0) cmd = cmd + "+";
            cmd = cmd + value;
            cmd = cmd + "\r";
        
            this.exec(cmd, function(response, error) {
                if (error) {
                    this.log('Serial volume function failed: %s');
                    callback(error);
                }
                else {
                    this.log("Set volume to", value, "db");
                    callback();
                }
            }.bind(this));
        }
        else {
            this.log("Volume has not changed");
            callback();
        }
    },
        
    increaseVolumeState: function(callback) {
        
        var cmd = "@VOL:1\r";
        
        this.exec(cmd, function(response, error) {
            if (error) {
                this.log('Serial increase volume function failed: %s');
                callback(error);
            }
            else {
                this.log("Increasing volume");
                this.audioDeviceService.getCharacteristic(MarantzAVR.AudioVolume).getValue(callback);
            }
        }.bind(this));
    },
        
    decreaseVolumeState: function(callback) {
        
        var cmd = "@VOL:2\r";
        
        this.exec(cmd, function(response, error) {
            if (error) {
                this.log('Serial decrease volume function failed: %s');
                callback(error);
            }
            else {
                this.log("Decreasing volume");
                this.audioDeviceService.getCharacteristic(MarantzAVR.AudioVolume).getValue(callback);
            }
        }.bind(this));
    },
        
    toggleTestTone: function(callback) {
        
        var cmd = "@TTO:0\r";
            
        this.exec(cmd, function(response, error) {
            if (error) {
                this.log('Serial volume function failed: %s');
                if(callback) callback(error);
            }
            else {
                this.log("Toggle test tone");
                if(callback) callback();
            }
        }.bind(this));
    },
        
    identify: function(callback) {
        this.log("Identify requested!");
        
        this.setPowerState(true); // turn on
        this.toggleTestTone();
        this.toggleTestTone(callback);
        
        if(callback) callback();
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

        var audioDeviceService = new MarantzAVR.AudioDeviceService("Audio Functions");
        audioDeviceService
        .getCharacteristic(MarantzAVR.Muting)
        .on('get', this.getMuteState.bind(this))
        .on('set', this.setMuteState.bind(this));
        
        this.audioDeviceService = audioDeviceService;
        
        audioDeviceService
        .getCharacteristic(MarantzAVR.AudioVolume)
        .on('get', this.getVolume.bind(this))
        .on('set', this.setVolume.bind(this));
        /*
        var increaseVolumeSwitchService = new Service.StatelessProgrammableSwitch("Increase Volume","Increase");
        increaseVolumeSwitchService
        .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
        .on('get', this.increaseVolumeState.bind(this));
        
        var decreaseVolumeSwitchService = new Service.StatelessProgrammableSwitch("Decrease Volume", "Decrease");
        decreaseVolumeSwitchService
        .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
        .on('set', this.decreaseVolumeState.bind(this));
         */
        return [informationService, switchService, audioDeviceService];//, increaseVolumeSwitchService, decreaseVolumeSwitchService];
    }
    }
};
