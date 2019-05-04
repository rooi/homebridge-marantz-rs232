// Accessory for controlling Marantz AVR via HomeKit

var inherits = require('util').inherits;
var SerialPort = require("serialport");
var Service, Characteristic;

// Use a `\r\n` as a line terminator
const parser = new SerialPort.parsers.Readline({
                                    delimiter: '\r'
                                    });

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
        this.callbackQueue = [];
        this.ready = true;
        
        this.log = log;
        
        this.volume = minVolume;
        
        this.serialPort = new SerialPort(this.path, {
                                         baudRate: 9600,
                                         autoOpen: false
                                         }); // this is the openImmediately flag [default is true]
        
        this.serialPort.pipe(parser);
        
        parser.on('data', function(data) {
                           
                           this.log("Received data: " + data);
                           this.serialPort.close(function(error) {
                                this.log("Closing connection");
                                if(error) this.log("Error when closing connection: " + error)
                                var callback;
                                if(this.callbackQueue.length) callback = this.callbackQueue.shift()
                                    if(callback) callback(data,0);
                                }.bind(this)); // close after response
                           }.bind(this));
    }
    
    // Custom Characteristics and service...
    MarantzAVR.AudioVolume = function() {
        Characteristic.call(this, 'Volume', '00001001-0000-1000-8000-135D67EC4377');
        this.log("Maximum Volume", maxVolume);
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
        if(this.queue.length > 100) {
            this.queue.clear();
            this.callbackQueue.clear();
        }
        
        this.queue.push(arguments);
        this.process();
    },
        
    sendCommand: function(command, callback) {
        this.log("serialPort.open");
        if(this.serialPort.isOpen){
            this.log("serialPort is already open...");
            if(callback) callback(0,1);
        }
        else{
            this.serialPort.open(function (error) {
                             if(error) {
                                this.log("Error when opening serialport: " + error);
                                if(callback) callback(0,error);
                             }
                             else {
                                 if(callback) this.callbackQueue.push(callback);
                                 this.serialPort.write(command, function(err) {
                                                   if(err) this.log("Write error = " + err);
                                                   //this.serialPort.drain();
                                                   }.bind(this));
                             }
                             //            if(callback) callback(0,0);
                             }.bind(this));
        }
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
        
        this.log("getPowerState");
        
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
        
    dbToPercentage: function(db) {
        this.log("dbToPercentage");
        var minMaxDiff = maxVolume - minVolume;
        this.log("db = " + db);
        var percentage = 100.0 * (db - minVolume) / minMaxDiff;
        this.log("percentage = " + percentage);
        return percentage;
    },
        
    percentageToDb: function(percentage) {
        this.log("percentageToDb");
        var minMaxDiff = maxVolume - minVolume;
        this.log("percentage = " + percentage);
        var db = 0.01 * percentage * minMaxDiff + minVolume;
        if(db > maxVolume) db = maxVolume;
        if(db < minVolume) db = minVolume;
        this.log("db = " + db);
        return db;
    },
        
    getVolume: function(callback) {
        var cmd = "@VOL:?\r";
        
        this.exec(cmd, function(response, error) {
                  
            //VOL:xxxy(xxx)
            if(response && response.indexOf("@VOL:") > -1) {
                  var vol = 0;
                  if(response.indexOf("+") > -1) {
                    //console.log("+");
                    vol = response.substring(6,8);
                  }
                  else {
                    //console.log("-");
                    vol = response.substring(5,8);
                  }
                  this.volume = this.dbToPercentage(Number(vol));
                  //console.log("this.volume=" + this.volume);
                  callback(null, Number(this.volume));
            }
            else callback(null,0);
        }.bind(this))
    },
        
    setVolume: function(value, callback) {
        
        var db = this.percentageToDb(value);
        if(this.volume != value) {
            this.volume = value;
            var cmd = "@VOL:0";
            if(db > 0) cmd = cmd + "+";
            cmd = cmd + parseInt(db*10.0);
            cmd = cmd + "\r";
            
            this.exec(cmd, function(response, error) {
                      if (error) {
                      this.log('Serial volume function failed: %s');
                      callback(error);
                      }
                      else {
                      this.log("Set volume to", db, "db");
                      callback();
                      }
                      }.bind(this));
        }
        else {
            this.log("Volume has not changed");
            callback();
        }
    },

    getVolumeUpState: function(callback) {
        callback(null, 0);
    },

    getVolumeDownState: function(callback) {
        callback(null, 0);
    },
        
    getVolumeUpFastState: function(callback) {
        callback(null, 0);
    },
        
    getVolumeDownFastState: function(callback) {
        callback(null, 0);
    },
        
    setVolumeUpState: function(value, callback) {
        
        var cmd = "@VOL:1\r";
        
        var signedValue = value;
        this.setVolumeState(cmd, signedValue, callback);
    },
        
    setVolumeDownState: function(value, callback) {
        
        var cmd = "@VOL:2\r";
        
        var signedValue = -1 * value;
        this.setVolumeState(cmd, signedValue, callback);
    },

    setVolumeUpFastState: function(value, callback) {
        
        var cmd = "@VOL:3\r";
        
        var signedValue = value;
        this.setVolumeState(cmd, signedValue, callback);
    },
        
    setVolumeDownFastState: function(value, callback) {
        
        var cmd = "@VOL:4\r";
        
        var signedValue = -1 * value;
        this.setVolumeState(cmd, signedValue, callback);
    },
        
    setVolumeState: function(cmd, value, callback) {
        
        if(value == 0) {
            this.log("Resetting volume up/down button");
            callback();
        }
        else if(value > 0 && this.volume >= 100) {
            this.log("Maximum volume reached");
            callback(); // limit the volume
        }
        else if(value < 0 && this.volume <= 0) {
            this.log("Minumum volume reached");
            callback(); // limit the volume
        }
        else {
            this.log('Executing: ' + cmd);
            
            this.exec(cmd, function(response, error) {
                if (error) {
                    this.log('Serial increase volume function failed: ' + error);
                    callback(error);
                }
                else {
                    this.log("Changing volume");
                    var tagetChar = this.volumeUpSwitchService.getCharacteristic(Characteristic.On);
                    var targetCharVol = this.speakerService.getCharacteristic(Characteristic.Volume);

                    targetCharVol.getValue(null);
                    setTimeout(function(){tagetChar.setValue(0);}, 10);
                    callback();
                }
            }.bind(this));
        }
    },

    toggleTestTone: function(callback) {
        
        var cmd = "@TTO:0\r";
        
        this.exec(cmd); // send without callback
        
        cmd = "@VOL:?\r"; // get confirmation with callback
        
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
        
    getSourcePort: function(callback) {
        var cmd = "@SRC:?\r";
        
        this.exec(cmd, function(response, error) {

            //SRC:xx
            if(response && response.indexOf("@SRC:") > -1) {
                  
                  var src = response.substring(6,7);
                
                  var srcNr = 0;
                  if(src == 'A') srcNr = 10;
                  else if(src == 'B') srcNr = 11;
                  else if(src == 'C') srcNr = 12;
                  else if(src == 'D') srcNr = 13;
                  else if(src == 'E') srcNr = 14;
                  else if(src == 'F') srcNr = 15;
                  else if(src == 'G') srcNr = 16;
                  else if(src == 'H') srcNr = 17;
                  else if(src == 'I') srcNr = 18;
                  else if(src == 'J') srcNr = 19;
                  else if(src == 'K') srcNr = 20;
                  else if(src == 'L') srcNr = 21;
                  else if(src == 'M') srcNr = 22;
                  else if(src == 'N') srcNr = 23;
                  else srcNr = Number(src);

                  //console.log("src =" + src + " srcNr = " + srcNr);
                  callback(null, srcNr);
            }
            else callback(null,0);
        }.bind(this))
    },
        
    setSourcePort: function(port, callback) {
        var cmd = "@SRC:";
        
        if (port < 10) cmd = cmd + port + "\r";
        else if(port == 10) cmd = cmd + 'A' + "\r";
        else if(port == 11) cmd = cmd + 'B' + "\r";
        else if(port == 12) cmd = cmd + 'C' + "\r";
        else if(port == 13) cmd = cmd + 'D' + "\r";
        else if(port == 14) cmd = cmd + 'E' + "\r";
        else if(port == 15) cmd = cmd + 'F' + "\r";
        else if(port == 16) cmd = cmd + 'G' + "\r";
        else if(port == 17) cmd = cmd + 'H' + "\r";
        else if(port == 18) cmd = cmd + 'I' + "\r";
        else if(port == 19) cmd = cmd + 'J' + "\r";
        else if(port == 20) cmd = cmd + 'K' + "\r";
        else if(port == 21) cmd = cmd + 'L' + "\r";
        else if(port == 22) cmd = cmd + 'M' + "\r";
        else if(port == 23) cmd = cmd + 'N' + "\r";
        else cmd = cmd + 0 + "\r";
        
        this.exec(cmd, function(response, error) {
            if (error) {
                this.log('Set Source function failed: ' + error);
                callback(error);
            }
            else {
                this.log('Set Source function succeeded!');
                callback();
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
        
        var switchService = new Service.Switch("Power State", "power_on");
        switchService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getPowerState.bind(this))
        .on('set', this.setPowerState.bind(this));
        
        var speakerService = new Service.Speaker("Speaker");
        speakerService
        .getCharacteristic(Characteristic.Mute)
        .on('get', this.getMuteState.bind(this))
        .on('set', this.setMuteState.bind(this));

        speakerService
        .getCharacteristic(Characteristic.Volume)
        .on('get', this.getVolume.bind(this))
        .on('set', this.setVolume.bind(this));
        
        this.speakerService = speakerService;
        
        makeHSourceCharacteristic();
        
        switchService
        .addCharacteristic(SourceCharacteristic)
        .on('get', this.getSourcePort.bind(this))
        .on('set', this.setSourcePort.bind(this));
        
        var volumeUpSwitchService = new Service.Switch("Volume Up", "volume_up");
        volumeUpSwitchService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getVolumeUpState.bind(this))
        .on('set', this.setVolumeUpState.bind(this));
        
        this.volumeUpSwitchService = volumeUpSwitchService;
        
        var volumeDownSwitchService = new Service.Switch("Volume Down", "volume_down");
        volumeDownSwitchService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getVolumeDownState.bind(this))
        .on('set', this.setVolumeDownState.bind(this));
        
        this.volumeDownSwitchService = volumeDownSwitchService;

        var volumeUpFastSwitchService = new Service.Switch("Volume Up Fast", "volume_up_fast");
        volumeUpFastSwitchService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getVolumeUpFastState.bind(this))
        .on('set', this.setVolumeUpFastState.bind(this));
        
        this.volumeUpFastSwitchService = volumeUpFastSwitchService;
        
        var volumeDownFastSwitchService = new Service.Switch("Volume Down Fast", "volume_down_fast");
        volumeDownFastSwitchService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getVolumeDownFastState.bind(this))
        .on('set', this.setVolumeDownFastState.bind(this));
        
        this.volumeDownFastSwitchService = volumeDownFastSwitchService;
        
        return [informationService, switchService, speakerService, volumeUpSwitchService, volumeDownSwitchService, volumeUpFastSwitchService, volumeDownFastSwitchService];
    }
    }
};

function makeHSourceCharacteristic() {
    
    SourceCharacteristic = function () {
        Characteristic.call(this, 'Source', '212131F4-2E14-4FF4-AE13-C97C3232499E');
        this.setProps({
                      format: Characteristic.Formats.INT,
                      unit: Characteristic.Units.NONE,
                      maxValue: 23,
                      minValue: 0,
                      minStep: 1,
                      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
                      });
        //this.eventEnabled = true;
        this.value = this.getDefaultValue();
    };
    
    inherits(SourceCharacteristic, Characteristic);
}
