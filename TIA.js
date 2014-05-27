var InterStella_TIA = (function() {

"use strict";

var InterStella_TIA = function(core)
{
   this.core = core;
   
   // Find the canvas and get the image data object out of it.
   // We won't be using the canvas drawing API at all,
   //  we'll just plot pixels manually by writing into the image data.
   var canvas_element = document.getElementById("interstella_canvas");
   this.drawing_context = canvas_element.getContext("2d");
   this.image_data = this.drawing_context.getImageData(0, 0, canvas_element.width, canvas_element.height);
};

InterStella_TIA.prototype.reset = function()
{
   // Fill the image with the default color to start off.
   this.clear_display();
   this.update_display();
   
   // Initialize the registers/flags.
   this.vsync = 0;
   this.vblank = 0;
   this.size_player_missle_0 = 0;
   this.number_player_missle_0 = 0;
   this.size_plater_missle_1 = 0;
   this.number_player_missle_1 = 0;
   this.color_player_missle_0 = 0;
   this.color_player_missle_1 = 0;
   this.color_playfield = 0;
   this.color_background = 0;
   this.size_ball = 0;
   this.playfield_reflect = 0;
   this.playfield_score = 0;
   this.playfield_priority = 0;
   this.reflect_player_0 = 0;
   this.reflect_player_1 = 0;
   this.data_playfield = 0x00000;
   this.reset_position_player_0 = 0;
   this.reset_position_player_1 = 0;
   this.reset_position_missle_0 = 0;
   this.reset_position_missle_1 = 0;
   this.reset_position_ball = 0;
   this.audio_control_0 = 0;
   this.audio_control_1 = 0;
   this.audio_freq_0 = 0;
   this.audio_freq_1 = 0;
   this.audio_vol_0 = 0;
   this.audio_vol_1 = 0;
   this.data_player_0 = 0x00;
   this.data_player_1 = 0x00;
   this.enable_missle_0 = 0;
   this.enable_missle_1 = 0;
   this.enable_ball = 0;
   this.h_motion_player_0 = 0;
   this.h_motion_player_1 = 0;
   this.h_motion_missle_0 = 0;
   this.h_motion_missle_1 = 0;
   this.h_motion_ball = 0;
   this.v_delay_player_0 = 0;
   this.v_delay_player_1 = 0;
   this.v_delay_ball = 0;
   this.reset_missle_0 = 0;
   this.reset_missle_1 = 0;
   this.collisions = {m0p1 : 0, m0p0 : 0, m1p0 : 0, m1p1 : 0, p0pf : 0,
                      p0bl : 0, p1pf : 0, p1bl : 0, m0pf : 0, m0bl : 0,
                      m1pf : 0, m1bl : 0, blpf : 0, p0p1 : 0, m0m1 : 0};
   
   // Internal variables, not exposed to the processor.
   this.wsync = false;
   this.h_counter = 0;
   this.v_counter = 0;
   this.position_player_0 = 0;
   this.position_player_1 = 0;
   this.position_missle_0 = 0;
   this.position_missle_1 = 0;
   this.position_ball = 0;
};

InterStella_TIA.prototype.clock = function(cpu_cycles)
{
   // If we're in the picture area of the frame, do some rendering.
   if (!this.vsync && !this.vblank &&
       (this.v_counter >= 40) && (this.v_counter < 232) && (this.h_counter > 67))
   {
      this.render_pixels(cpu_cycles * 3);
   }

   // Update the horizontal counter, and the vertical counter if the horizontal overflowed.
   this.h_counter = (this.h_counter + (cpu_cycles * 3)) % 228;
   if (this.h_counter < (cpu_cycles * 3))
   {
      this.v_counter = (this.v_counter + 1) % 262;
      // Update the display if we're starting a new frame now.
      if (!this.v_counter)
         this.update_display();
   }
   
   // If the CPU wants us to halt it until the end of the scanline, oblige it.
   if (this.wsync)
   {
      this.wsync = false;
      
      // See if we need to render the rest of the scanline.
      if (!this.vsync && !this.vblank &&
          (this.v_counter >= 40) && (this.v_counter < 232) && (this.h_counter > 67) &&
          (this.h_counter < 227))
      {
         this.render_pixels((227 - this.h_counter) * 3);
      }

      var retval = ((227 - this.h_counter) + cpu_cycles) * 3;
      this.h_counter = 0;
      this.v_counter = (this.v_counter + 1) % 262;
      return retval;
   }
   else
   {
      return cpu_cycles * 3;
   }
};

InterStella_TIA.prototype.read = function(address)
{
   // Only the collision bits are actually handled in this module.
   // Technically the input ports are also the job of the TIA hardware,
   //  but we handle all the input in the core module.
   if (address === 0)
      return (this.collisions.m0p1 << 7) | (this.collisions.m0p0 << 6);
   else if (address === 1)
      return (this.collisions.m1p0 << 7) | (this.collisions.m1p1 << 6);
   else if (address === 2)
      return (this.collisions.p0pf << 7) | (this.collisions.p0bl << 6);
   else if (address === 3)
      return (this.collisions.p1pf << 7) | (this.collisions.p1bl << 6);
   else if (address === 4)
      return (this.collisions.m0pf << 7) | (this.collisions.m0bl << 6);
   else if (address === 5)
      return (this.collisions.m1pf << 7) | (this.collisions.m1bl << 6);
   else if (address === 6)
      return (this.collisions.blpf << 7);
   else if (address === 7)
      return (this.collisions.p0p1 << 7) | (this.collisions.m0m1 << 6);
   else
      return 0;
};

InterStella_TIA.prototype.write = function(address, value)
{
   if (address === 0)
      this.vsync = (value & 0x02) >>> 1;
   else if (address === 1)
      this.vblank = (value & 0x80) >>> 7;
   else if (address === 2)
      this.wsync = true;
   else if (address === 3)
      this.h_counter = 0;
   else if (address === 4)
   {
      this.size_player_missle_0 = ((value & 0x30) >>> 4);
      this.number_player_missle_0 = value & 0x07;
   }
   else if (address === 5)
   {
      this.size_player_missle_1 = ((value & 0x30) >>> 4);
      this.number_player_missle_1 = value & 0x07;
   }
   else if (address === 6)
      this.color_player_missle_0 = value >>> 1;
   else if (address === 7)
      this.color_player_missle_1 = value >>> 1;
   else if (address === 8)
      this.color_playfield = value >>> 1;
   else if (address === 9)
      this.color_background = value >>> 1;
   else if (address === 0x0a)
   {
      this.playfield_reflect = value & 0x01;
      this.playfield_score = ((value & 0x02) >>> 1);
      this.playfield_priority = ((value & 0x04) >>> 2);
      this.size_ball = ((value & 0x30) >>> 4);
   }
   else if (address === 0x0b)
      this.reflect_player_0 = ((value & 0x08) >>> 3);
   else if (address === 0x0c)
      this.reflect_player_1 = ((value & 0x08) >>> 3);
   else if (address === 0x0d)
      this.data_playfield = (this.data_playfield & 0x0ffff) | ((value & 0xf0) << 12);
   else if (address === 0x0e)
      this.data_playfield = (this.data_playfield & 0xf00ff) | (value << 8);
   else if (address === 0x0f)
      this.data_playfield = (this.data_playfield & 0xfff00) | value;
   else if (address === 0x10)
      this.reset_position_player_0 = this.h_counter;
   else if (address === 0x11)
      this.reset_position_player_1 = this.h_counter;
   else if (address === 0x12)
      this.reset_position_missle_0 = this.h_counter;
   else if (address === 0x13)
      this.reset_position_missle_1 = this.h_counter;
   else if (address === 0x14)
      this.reset_position_ball = this.h_counter;
   else if (address === 0x15)
      this.audio_control_0 = value & 0x0f;
   else if (address === 0x16)
      this.audio_control_1 = value & 0x1f;
   else if (address === 0x17)
      this.audio_freq_0 = value & 0x0f;
   else if (address === 0x18)
      this.audio_freq_1 = value & 0x0f;
   else if (address === 0x19)
      this.audio_vol_0 = value & 0x0f;
   else if (address === 0x1a)
      this.audio_vol_1 = value & 0x0f;
   else if (address === 0x1b)
      this.data_player_0 = value;
   else if (address === 0x1c)
      this.data_player_1 = value;
   else if (address === 0x1d)
      this.enable_missle_0 = ((value & 0x02) >>> 1);
   else if (address === 0x1e)
      this.enable_missle_1 = ((value & 0x02) >>> 1);
   else if (address === 0x1f)
      this.enable_ball = ((value & 0x02) >>> 1);
   else if (address === 0x20)
      this.h_motion_player_0 = ((value & 0xf0) >>> 4);
   else if (address === 0x21)
      this.h_motion_player_1 = ((value & 0xf0) >>> 4);
   else if (address === 0x22)
      this.h_motion_missle_0 = ((value & 0xf0) >>> 4);
   else if (address === 0x23)
      this.h_motion_missle_1 = ((value & 0xf0) >>> 4);
   else if (address === 0x24)
      this.h_motion_ball = ((value & 0xf0) >>> 4);
   else if (address === 0x25)
      this.v_delay_player_0 = value & 0x01;
   else if (address === 0x26)
      this.v_delay_player_1 = value & 0x01;
   else if (address === 0x27)
      this.v_delay_ball = value & 0x01;
   else if (address === 0x28)
      this.reset_missle_0 = ((value & 0x02) >>> 1);
   else if (address === 0x29)
      this.reset_missle_1 = ((value & 0x02) >>> 1);
   else if (address === 0x2a)
   {
      // Apply horizontal motion
   }
   else if (address === 0x2b)
   {
      // Clear horizontal motion registers
      this.h_motion_player_0 = this.h_motion_player_1 =
      this.h_motion_missle_0 = this.h_motion_missle_1 =
      this.h_motion_ball = 0;
   }
   else if (address === 0x2c)
   {
      // Clear all collision latches
      this.collisions.m0p1 = this.collisions.m0p0 = this.collisions.m1p0 =
      this.collisions.m1p1 = this.collisions.p0pf = this.collisions.p0bl =
      this.collisions.p1pf = this.collisions.p1bl = this.collisions.m0pf =
      this.collisions.m0bl = this.collisions.m1pf = this.collisions.m1bl =
      this.collisions.blpf = this.collisions.p0p1 = this.collisions.m0m1 = 0;
   }
};

InterStella_TIA.prototype.render_pixels = function(num_pixels)
{
   // Figure out what to do for each pixel we were told to plot.
   for (var x = this.h_counter; x < (this.h_counter + num_pixels); ++x)
   {
      // Skip to the next pixel if this is the H blank interval,
      //  and exit the loop entirely if we've gone off the end of the line.
      if (x < 68)
         continue;
      else if (x >= 228)
         break;
      
      // We'll handle the playfield first. Get the PF bit for this screen pixel.
      var pf_pixel_index = Math.floor(((x - 68) % 80) / 4);
      if ((x >= 148) && this.playfield_reflect)
      {
         pf_pixel_index = 19 - pf_pixel_index;
      }

      var pf_data_bit = 0;
      if (pf_pixel_index < 4)
      {
         pf_data_bit = ((this.data_playfield & 0xf0000) >>> 16) & Math.pow(2, 3 - pf_pixel_index);
      }
      else if (pf_pixel_index < 12)
      {
         pf_data_bit = ((this.data_playfield & 0x0ff00) >>> 8) & Math.pow(2, 11 - pf_pixel_index);
      }
      else
      {
         pf_data_bit = (this.data_playfield & 0x000ff) & Math.pow(2, 19 - pf_pixel_index);
      }
      
      var pf_color = pf_data_bit ? this.color_playfield : this.color_background;
      
      this.put_pixel(x - 68, this.v_counter - 40, pf_color);
   }
};

InterStella_TIA.prototype.update_display = function()
{
   this.drawing_context.putImageData(this.image_data, 0, 0);
};

InterStella_TIA.prototype.clear_display = function()
{
   for (var y = 0; y < this.image_data.height; ++y)
      for (var x = 0; x < this.image_data.width; ++x)
         this.put_pixel(x, y, 0);
};

InterStella_TIA.prototype.put_pixel = function(x, y, color_index)
{
   var color = this.palette[color_index];
   this.image_data.data[(((y * this.image_data.width) + x) * 4)] = color[0];
   this.image_data.data[(((y * this.image_data.width) + x) * 4) + 1] = color[1];
   this.image_data.data[(((y * this.image_data.width) + x) * 4) + 2] = color[2];
   this.image_data.data[(((y * this.image_data.width) + x) * 4) + 3] = 255;
};

// This is the NTSC palette. My source for this data is
//  http://en.wikipedia.org/w/index.php?title=Television_Interface_Adaptor&oldid=609440874#TIA_Color_Capabilities
// There is one array here for each of the 128 values of the color registers.
// The numbers in the arrays are in RGB order.
InterStella_TIA.prototype.palette = [
[0x00,0x00,0x00],[0x40,0x40,0x40],[0x6c,0x6c,0x6c],[0x90,0x90,0x90],[0xb0,0xb0,0xb0],[0xc8,0xc8,0xc8],[0xdc,0xdc,0xdc],[0xec,0xec,0xec], // Hue 0 (grey)
[0x44,0x44,0x00],[0x64,0x64,0x10],[0x84,0x84,0x24],[0xa0,0xa0,0x34],[0xb8,0xb8,0x40],[0xd0,0xd0,0x50],[0xe8,0xe8,0x5c],[0xfc,0xfc,0x68], // Hue 1 (yellow)
[0x70,0x28,0x00],[0x84,0x44,0x14],[0x98,0x5c,0x28],[0xac,0x78,0x3c],[0xbc,0x8c,0x4c],[0xcc,0xa0,0x5c],[0xdc,0xb4,0x68],[0xec,0xc8,0x78], // Hue 2 (burnt orange)
[0x84,0x18,0x00],[0x98,0x34,0x18],[0xac,0x50,0x30],[0xc0,0x68,0x48],[0xd0,0x80,0x5c],[0xe0,0x94,0x70],[0xec,0xa8,0x80],[0xfc,0xbc,0x94], // Hue 3 (orange)
[0x88,0x00,0x00],[0x9c,0x20,0x20],[0xb0,0x3c,0x3c],[0xc0,0x58,0x58],[0xd0,0x70,0x70],[0xe0,0x88,0x88],[0xec,0xa0,0xa0],[0xfc,0xb4,0xb4], // Hue 4 (red)
[0x78,0x00,0x5c],[0x8c,0x20,0x74],[0xa0,0x3c,0x88],[0xb0,0x58,0x9c],[0xc0,0x70,0xb0],[0xd0,0x84,0xc0],[0xdc,0x9c,0xd0],[0xec,0xb0,0xe0], // Hue 5 (pink)
[0x48,0x00,0x78],[0x60,0x20,0x90],[0x78,0x3c,0xa4],[0x8c,0x58,0xb8],[0xa0,0x70,0xcc],[0xb4,0x84,0xdc],[0xc4,0x9c,0xec],[0xd4,0xb0,0xfc], // Hue 6 (purple)
[0x14,0x00,0x84],[0x30,0x20,0x98],[0x4c,0x3c,0xac],[0x68,0x58,0xc0],[0x7c,0x70,0xd0],[0x94,0x88,0xe0],[0xa8,0xa0,0xec],[0xbc,0xb4,0xfc], // Hue 7 (indigo)
[0x00,0x00,0x88],[0x1c,0x20,0x9c],[0x38,0x40,0xb0],[0x50,0x5c,0xc0],[0x68,0x74,0xd0],[0x7c,0x8c,0xe0],[0x90,0xa4,0xec],[0xa4,0xb8,0xfc], // Hue 8 (blue)
[0x00,0x18,0x7c],[0x1c,0x38,0x90],[0x38,0x54,0xa8],[0x50,0x70,0xbc],[0x68,0x88,0xcc],[0x7c,0x9c,0xdc],[0x90,0xb4,0xec],[0xa4,0xc8,0xfc], // Hue 9 (light blue)
[0x00,0x2c,0x5c],[0x1c,0x4c,0x78],[0x38,0x68,0x90],[0x50,0x84,0xac],[0x68,0x9c,0xc0],[0x7c,0xb4,0xd4],[0x90,0xcc,0xe8],[0xa4,0xe0,0xfc], // Hue 10 (teal)
[0x00,0x3c,0x2c],[0x1c,0x5c,0x48],[0x38,0x7c,0x64],[0x50,0x9c,0x80],[0x68,0xb4,0x94],[0x7c,0xd0,0xac],[0x90,0xe4,0xc0],[0xa4,0xfc,0xd4], // Hue 11 (seafoam)
[0x00,0x3c,0x00],[0x20,0x5c,0x20],[0x40,0x7c,0x40],[0x5c,0x9c,0x5c],[0x74,0xb4,0x74],[0x8c,0xd0,0x8c],[0xa4,0xe4,0xa4],[0xb8,0xfc,0xb8], // Hue 12 (green)
[0x14,0x38,0x00],[0x34,0x5c,0x1c],[0x50,0x7c,0x38],[0x6c,0x98,0x50],[0x84,0xb4,0x68],[0x9c,0xcc,0x7c],[0xb4,0xe4,0x90],[0xc8,0xfc,0xa4], // Hue 13 (light green)
[0x2c,0x30,0x00],[0x4c,0x50,0x1c],[0x68,0x70,0x34],[0x84,0x8c,0x4c],[0x9c,0xa8,0x64],[0xb4,0xc0,0x78],[0xcc,0xd4,0x88],[0xe0,0xec,0x9c], // Hue 14 (brown-green)
[0x44,0x28,0x00],[0x64,0x48,0x18],[0x84,0x68,0x30],[0xa0,0x84,0x44],[0xb8,0x9c,0x58],[0xd0,0xb4,0x6c],[0xe8,0xcc,0x7c],[0xfc,0xe0,0x8c]  // Hue 15 (brown)
];

return InterStella_TIA;
})();
