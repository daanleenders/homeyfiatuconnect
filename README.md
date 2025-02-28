# <img src="./assets/icon.svg" width="80" height="80" style="vertical-align: middle;"> FiatUConnect

Connect your FIAT to homey to see its information and control some functions. Needs a car with uconnect services enabled and valid fiat account.

Currently only tested with a Fiat 500e

## Acknowledgements

Build from the base "create new homey app" of the [homey cli](https://github.com/athombv/node-homey).

Thanks to [wubbl0rz](https://github.com/wubbl0rz)'s (and fellow contributors) work on 
[FiatChamp](https://github.com/wubbl0rz/FiatChamp) which mapped the possibilities of the FIAT UConnect API. 
And [schmidmuc](https://github.com/schmidmuc)'s work on creating a PHP version to talk to the API with 
([schmidmuc/fiat_vehicle](https://github.com/schmidmuc/fiat_vehicle)), which is a language I am more familiar
with than the C# used in FiatChamp. Which I then used shamelessly to  build my own version of their project
but for Homey instead.

Thanks to [IvoDerksen](https://github.com/IvoDerksen) for the design of the [fiat 500 icon](https://github.com/athombv/homey-vectors-public/commit/3eb90d49283488ad78e34d845aaed1fb0a2442e1) used for the fiatVehicle driver/device.
