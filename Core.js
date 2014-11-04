var InterStella_core = (function() {

"use strict";

var InterStella_core = function()
{
   this.cpu = new MOS6502(this);
   this.cart = new InterStella_cart(this);
   this.tia = new InterStella_TIA(this);
   
   this.paused = false;
   
   // The PIA is implemented in this module. These are its registers/data.
   // RAM built into the console. All 128 bytes of it.
   // The cartridge may have more of its own.
   this.sys_ram = new Uint8Array(128);
   // Input or output states of each pin of each port.
   this.port_a_direction = 0;
   this.port_b_direction = 0;
   // Values to be used when each port is set to output.
   this.port_a_output = 0;
   this.port_b_output = 0;
   // Timer state and configuration.
   this.timer = 42; // According to the Stella code, the timer can't start at 0.
   this.timer_interval = 1;
   this.timer_interval_saved = 1;
   // There are two underflow bits, cleared at different times.
   this.timer_underflow_1 = 0;
   this.timer_underflow_2 = 0;
   
   // Button/switch states, to be copied into the actual registers.
   this.joystick = {button: false, up: false, down: false, left: false, right: false};
   this.switches = {select: false, reset: false};
};

// Frequency of the NTSC TIA, from which the CPU clock is derived.
// Since the TIA owns the master clock and controls the CPU clock,
//  the TIA is the clock we have to use to control the framerate.
InterStella_core.prototype.TIA_CLOCK_RATE = 3579545; // cycles per second

InterStella_core.prototype.run_one_frame = function()
{
   var cycle_counter = 0;
   while (cycle_counter <= (this.TIA_CLOCK_RATE / 60))
   {
      // Run one CPU instruction, then ask the TIA for the number of "real" cycles
      //  that will be consumed as a result, since the TIA could decide to
      //  halt the CPU for a while by ceasing to run its clock signal.
      var cpu_cycles = this.cpu.run_instruction();
      var tia_cycles = this.tia.clock(cpu_cycles);
      // Now evaluate the new timer states.
      // The timer is based of CPU cycles, to turn the TIA cycles back into those.
      this.timer -= (tia_cycles * 3) / this.timer_interval;
      if (this.timer < 0)
      {
         this.timer += 0xff;
         this.timer_underflow_1 = 1;
         this.timer_underflow_2 = 1;
         this.timer_interval = 1;
      }

      cycle_counter += tia_cycles;
   }
      
   if (!this.paused)
   {
      window.requestAnimationFrame(this.run_one_frame.bind(this));
   }
};

InterStella_core.prototype.run = function()
{
   this.cpu.reset();
   this.tia.reset();
   
   document.getElementById("pause_button").removeAttribute("disabled");
   document.getElementById("pause_button").style.display = "inline";
   document.getElementById("resume_button").disabled = "disabled";
   document.getElementById("resume_button").style.display = "none";
   document.getElementById("reset_button").removeAttribute("disabled");
   document.getElementById("select_button").removeAttribute("disabled");

   this.paused = false;
   window.requestAnimationFrame(this.run_one_frame.bind(this));
};

InterStella_core.prototype.pause = function()
{
   document.getElementById("pause_button").disabled = "disabled";
   document.getElementById("pause_button").style.display = "none";
   document.getElementById("resume_button").removeAttribute("disabled");
   document.getElementById("resume_button").style.display = "inline";
   document.getElementById("reset_button").disabled = "disabled";
   document.getElementById("select_button").disabled = "disabled";

   this.paused = true;
};

InterStella_core.prototype.resume = function()
{
   if (this.paused)
   {
      document.getElementById("pause_button").removeAttribute("disabled");
      document.getElementById("pause_button").style.display = "inline";
      document.getElementById("resume_button").disabled = "disabled";
      document.getElementById("resume_button").style.display = "none";
      document.getElementById("reset_button").removeAttribute("disabled");
      document.getElementById("select_button").removeAttribute("disabled");
   
      this.paused = false;
      window.requestAnimationFrame(this.run_one_frame.bind(this));
   }
};

InterStella_core.prototype.reset_down = function()
{
   this.switches.reset = true;
};

InterStella_core.prototype.reset_up = function()
{
   this.switches.reset = false;
};

InterStella_core.prototype.select_down = function()
{
   this.switches.select = true;
};

InterStella_core.prototype.select_up = function()
{
   this.switches.select = false;
};

InterStella_core.prototype.set_rom = function(rom)
{
   this.cart.load_rom(rom);
   this.run();
};

InterStella_core.prototype.key_down = function(event)
{
   if (event.keyCode === 90)      // Z key
      this.joystick.button = true;
   else if (event.keyCode === 38) // Up key
      this.joystick.up = true;
   else if (event.keyCode === 40) // Down key
      this.joystick.down = true;
   else if (event.keyCode === 37) // Left key
      this.joystick.left = true;
   else if (event.keyCode === 39) // Right key
      this.joystick.right = true;
};

InterStella_core.prototype.key_up = function(event)
{
   if (event.keyCode === 90)      // Z key
      this.joystick.button = false;
   else if (event.keyCode === 38) // Up key
      this.joystick.up = false;
   else if (event.keyCode === 40) // Down key
      this.joystick.down = false;
   else if (event.keyCode === 37) // Left key
      this.joystick.left = false;
   else if (event.keyCode === 39) // Right key
      this.joystick.right = false;
};

InterStella_core.prototype.read_port_a = function()
{
   var stick = (this.joystick.up << 4) | (this.joystick.down << 5) |
               (this.joystick.left << 6) | (this.joystick.right << 7);

   // From the Stella M6532.cxx file:
   // Each pin is high (1) by default and will only go low (0) if either
   //  (a) External device drives the pin low
   //  (b) Corresponding bit in SWACNT = 1 and SWCHA = 0
   // Thanks to A. Herbert for this info
   return 0xff & ((this.port_a_output | ~this.port_a_direction) & stick);
};

InterStella_core.prototype.read_port_b = function()
{
   var switches = (this.switches.reset ? 0 : 1) |
                 ((this.switches.select ? 0 : 1) << 1) |
                 (1 << 3) | // We don't emulate the C/BW switch, lock it at Color.
                 ((!!document.getElementById("p1_diff_a").checked ? 1 : 0) << 6) |
                 ((!!document.getElementById("p2_diff_a").checked ? 1 : 0) << 7);
   
   return 0xff & ((this.port_b_output | ~this.port_b_direction) &
                  (switches | this.port_b_direction));
};

InterStella_core.prototype.mem_read = function(address)
{
   // There are only 13 address lines.
   address &= 0x1fff;
   
   if ((address & 0x1280) === 0x0080)
   {
      // Internal RAM
      return this.sys_ram[address & 0x007f];
   }
   else if ((address & 0x1280) === 0x0280)
   {
      // PIA I/O
      address &= 0x0007;

      if (address === 0) return this.read_port_a();
      else if (address === 1) return this.port_a_direction;
      else if (address === 2) return this.read_port_b();
      else if (address === 3) return this.port_b_direction;
      else if ((address === 4) || (address === 6)) return this.timer;
      else
      {
         var retval = ((this.timer_underflow_1 << 7) | (this.timer_underflow_2 << 6));
         this.timer_underflow_1 = 0;
         return retval;
      }
   }
   else if ((address & 0x1088) === 0x0008)
   {
      // These are technically TIA registers, but they deal with control inputs,
      //  so we'll handle them here where the rest of our control stuff is.
      // Only one joystick is implemented here.
      if ((address & 0x000f) === 0x0c)
      {
         return (this.joystick.button << 7);
      }
      else
      {
         return 0;
      }
   }
   else if ((address & 0x1080) === 0x0000)
   {
      // TIA
      return this.tia.read(address & 0x000f);
   }
   else
   {
      // Cartridge
      return this.cart.read(address & 0x0fff);
   }
   
   // Just in case we failed to handle something.
   return 0;
};

InterStella_core.prototype.mem_write = function(address, value)
{
   // There are 13 address lines and 8 data lines.
   address &= 0x1fff;
   value &= 0xff;

   if ((address & 0x1280) === 0x0080)
   {
      // Internal RAM
      this.sys_ram[address & 0x007f] = value;
   }
   else if ((address & 0x1080) === 0x0000)
   {
      // TIA
      this.tia.write(address & 0x003f, value);
   }
   else if ((address & 0x1280) === 0x0280)
   {
      // PIA I/O
      if (address & 0x0040)
      {
         if (address & 0x0010)
         {
            // Timer value and interval
            this.timer = value;
            this.timer_interval = ((address & 0x03) === 0) ? 1 :
                                  ((address & 0x03) === 1) ? 8 :
                                  ((address & 0x03) === 2) ? 64 : 1024;
            this.timer_interval_saved = this.timer_interval;
            
         }
         else
         {
            // Edge detect control. We don't have this.
         }
      }
      else
      {
         address &= 0x0003;
         if (address === 0x0)
         {
            this.port_a_output = value;
         }
         else if (address === 0x1)
         {
            this.port_a_direction = value;
         }
         else if (address === 0x2)
         {
            this.port_b_output = value;
         }
         else
         {
            this.port_b_direction = value;
         }
      }         
   }
   else
   {
      // Cartridge
      this.cart.read(address & 0x0fff, value);
   }
};

return InterStella_core;
})();
