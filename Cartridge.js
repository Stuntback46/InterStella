var InterStella_cart = (function() {

"use strict";

var InterStella_cart = function(core)
{
   this.core = core;
};

InterStella_cart.prototype.load_rom = function(rom)
{
   this.rom = new Uint8Array(rom);
   
   // Assume that everything is a 4K cartridge for now.
   // We'll worry about cartridge type detection and banking later.
   // That means we don't have any work to do here.
};

InterStella_cart.prototype.read = function(address)
{
   return this.rom[address];
};

InterStella_cart.prototype.write = function(address, value)
{
   this.rom[address] = value;
};

return InterStella_cart;
})();
