// Accessory for controlling Marantz AVR via HomeKit

var inherits = require('util').inherits;
var SerialPort = require("serialport");
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
        
        this.timeout = config.timeout || 100;
        this.queue = [];
        this.callbackQueue = [];
        this.ready = true;
        
        this.log = log;
        
        this.volume = minVolume;
        
        this.serialPort = new SerialPort(this.path, {
                                         baudrate: 9600,
                                         parser: SerialPort.parsers.readline("\r"),
                                         autoOpen: false
                                         }); // this is the openImmediately flag [default is true]
        
        this.serialPort.on('data', function(data) {
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
        if(this.queue.length > 50) {
            this.queue.clear();
            this.callbackQueue.clear();
        }
        
        this.queue.push(arguments);
        this.process();
    },
        
    sendCommand: function(command, callback) {
        this.log("serialPort.open");
        this.serialPort.open(function (error) {
                             if(error) this.log("Error when opening serialport: " + error);
                             
                             if(callback) this.callbackQueue.push(callback);
                             
                             this.serialPort.write(command, function(err) {
                                                   if(err) this.log("Write error = " + err);
                                                   //this.serialPort.drain();
                                                   }.bind(this));
                             
                             //            if(callback) callback(0,0);
                             }.bind(this));
    },
        /*
         sendCommand: function(command, callback) {
         var that = this;
         that.callback = callback;
         
         //if(that.serialPort.isOpen()) that.serialPort.close();
         that.log("Opening connection");
         that.serialPort.open(function (error, callback) {
         if ( error ) {
         that.log('failed to open: '+error);
         if(callback) callback(0,1);
         } else {
         console.log('open and write command ' + command);
         that.serialPort.on('data', function(data, callback) {
         that.log("Received data: " + data);
         if(that.serialPort.isOpen) {
         that.serialPort.close(function(error,callback) {
         that.log("Closing connection");
         if(error) that.log("Error when closing connection: " + error)
         if(that.callback) that.callback(data,0);
         }); // close after response
         }
         else {
         if(callback) callback(data,0);
         }
         });
         that.serialPort.write(command, function(err, results) {
         if(err) that.log("Write error = " + err);
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
         */
        
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
                  this.volume = this.dbToPercentage(Number(vol));
                  console.log("vol=" + vol);
                  callback(null, Number(vol));
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
        
        var speakerService = new Service.Speaker("Speaker");
        speakerService
        .getCharacteristic(Characteristic.Mute)
        .on('get', this.getMuteState.bind(this))
        .on('set', this.setMuteState.bind(this));

        speakerService
        .getCharacteristic(Characteristic.Volume)
        .on('get', this.getVolume.bind(this))
        .on('set', this.setVolume.bind(this));

        
        /*
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
         */
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
        return [informationService, switchService, speakerService];//, increaseVolumeSwitchService, decreaseVolumeSwitchService];
    }
    }
};