# homebridge-marantz-rs232
Marantz rs232 receiver plugin for homebridge: https://github.com/nfarina/homebridge
This plugin communicates with Marantz receiver using rs-232 and is tested with the SR5004. An usb to serial rs232 converter from [FTDI](https://www.ftdichip.com/Products/Cables/USBRS232.htm) is recommended. Cheaper converters may not function correctly.

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-marantz-rs232  --unsafe-perm
3. Update your configuration file. See the sample below.

# Configuration

Configuration sample:

 ```
"accessories": [
    {
        "accessory": "Marantz-RS232",
        "name": "Receiver",
        "path": "/dev/cu.usbserial-FTH7QVHK",
        "maxVolume": -20.0,
        "minVolume": -79.0
    }
]
```

