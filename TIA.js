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
   this.position_player_0 = 0;
   this.position_player_1 = 0;
   this.position_missle_0 = 0;
   this.position_missle_1 = 0;
   this.position_ball = 0;
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
   this.beam = {x:0, y:0};
   this.position_player_0 = 0;
   this.position_player_1 = 0;
   this.position_missle_0 = 0;
   this.position_missle_1 = 0;
   this.position_ball = 0;
};

InterStella_TIA.prototype.clock = function(cpu_cycles)
{
   // Figure out how many color clocks just elapsed and update the beam position.
   var pixels = cpu_cycles * 3;
   // Render that many pixels.
   this.render_pixels(pixels);
   
   // Advance the beam and run the rest of the scanline if the CPU told us to.
   this.beam.x += pixels;
   if (this.beam.x > 227)
   {
      this.beam.x -= 228;
      // In VBLANK the beam isn't actually moving.
      this.beam.y = (!this.vblank && !this.vsync) ? ((this.beam.y + 1) % 222) : 0;
      // Update the display if we're starting a new frame now.
      if (!this.beam.y)
         this.update_display();
   }
   if (this.wsync)
   {
      this.wsync = false;
      pixels += (228 - this.beam.x);
      
      // Render whatever we just added.
      this.render_pixels(228 - this.beam.x);
      
      // Update the beam position once again.
      this.beam.x = 0;
      this.beam.y = (!this.vblank && !this.vsync) ? ((this.beam.y + 1) % 222) : 0;
      // Update the display if we're starting a new frame now.
      if (!this.beam.y)
         this.update_display();
   }

   return pixels;
};

InterStella_TIA.prototype.render_pixels = function(num_pixels)
{
   // We'll draw some of the overscan area, but not all of it.
   if (this.beam.y >= 200)
      return;

   // Figure out what to do for each pixel we were told to plot, up to the end of the line.
   for (var x = this.beam.x; (x < (this.beam.x + num_pixels)) && (x < 228); ++x)
   {
      // Skip to the next pixel if this is the H blank interval.
      if (x < 68) continue;
      
      var pf_data_bit, ball_data_bit, p0_data_bit, p1_data_bit, m0_data_bit, m1_data_bit;
      
      // We'll handle the playfield first. Get the PF bit for this screen pixel.
      var pf_pixel_index = Math.floor(((x - 68) % 80) / 4);
      if ((x >= 148) && this.playfield_reflect)
      {
         pf_pixel_index = 19 - pf_pixel_index;
      }

      if (pf_pixel_index < 4)
      {
         // These bits are displayed in inverted order, with bit 0 on the left.
         pf_pixel_index = (pf_pixel_index === 3) ? 0 :
                          (pf_pixel_index === 2) ? 1 :
                          (pf_pixel_index === 1) ? 2 : 3;
         pf_data_bit = ((this.data_playfield & 0xf0000) >>> 16) & Math.pow(2, 3 - pf_pixel_index);
      }
      else if (pf_pixel_index < 12)
      {
         pf_data_bit = ((this.data_playfield & 0x0ff00) >>> 8) & Math.pow(2, 11 - pf_pixel_index);
      }
      else
      {
         // These bits are displayed in inverted order, with bit 0 on the left.
         pf_pixel_index = (pf_pixel_index === 19) ? 12 :
                          (pf_pixel_index === 18) ? 13 :
                          (pf_pixel_index === 17) ? 14 :
                          (pf_pixel_index === 16) ? 15 :
                          (pf_pixel_index === 15) ? 16 :
                          (pf_pixel_index === 14) ? 17 :
                          (pf_pixel_index === 13) ? 18 : 19;
         pf_data_bit = (this.data_playfield & 0x000ff) & Math.pow(2, 19 - pf_pixel_index);
      }
      
      // Now figure out whether any of the movable objects are here.
      // First, the ball.
      
      // Now players 0 and 1.
      
      // And now missles 0 and 1.

      // Evaluate the collision bits.
      if (m0_data_bit && p1_data_bit)
         this.collisions.m0p1 = 1;
      if (m0_data_bit && p0_data_bit)
         this.collisions.m0p0 = 1;
      if (m1_data_bit && p0_data_bit)
         this.collisions.m1p0 = 1;
      if (m1_data_bit && p1_data_bit)
         this.collisions.m1p1 = 1;
      if (p0_data_bit && pf_data_bit)
         this.collisions.p0pf = 1;
      if (p0_data_bit && ball_data_bit)
         this.collisions.p0bl = 1;
      if (p1_data_bit && pf_data_bit)
         this.collisions.p1pf = 1;
      if (pf_data_bit && ball_data_bit)
         this.collisions.p1bl = 1;
      if (m0_data_bit && pf_data_bit)
         this.collisions.m0pf = 1;
      if (m0_data_bit && ball_data_bit)
         this.collisions.m0bl = 1;
      if (m1_data_bit && pf_data_bit)
         this.collisions.m1pf = 1;
      if (m1_data_bit && ball_data_bit)
         this.collisions.m1bl = 1;
      if (ball_data_bit && pf_data_bit)
         this.collisions.blpf = 1;
      if (p0_data_bit && p1_data_bit)
         this.collisions.p0p1 = 1;
      if (m0_data_bit && m1_data_bit)
         this.collisions.m0m1 = 1;
      
      // Determine which color to plot based on priority.
      var pixel_color = this.color_background;
      if (this.playfield_priority)
      {
         if (pf_data_bit || ball_data_bit)
            if (this.playfield_score && pf_data_bit)
               pixel_color = (x < 148) ? this.color_player_missle_0 : this.color_player_missle_1;
            else
               pixel_color = this.color_playfield;
         else if (p0_data_bit || m0_data_bit)
            pixel_color = this.color_player_missle_0;
         else if (p1_data_bit || m1_data_bit)
            pixel_color = this.color_player_missle_1;
      }
      else
      {
         if (p0_data_bit || m0_data_bit)
            pixel_color = this.color_player_missle_0;
         else if (p1_data_bit || m1_data_bit)
            pixel_color = this.color_player_missle_1;
         else if (pf_data_bit || ball_data_bit)
            if (this.playfield_score && pf_data_bit)
               pixel_color = (x < 148) ? this.color_player_missle_0 : this.color_player_missle_1;
            else
               pixel_color = this.color_playfield;
      }

      // Finally actually plot the pixel.
      this.put_pixel(x - 68, this.beam.y, pixel_color);
   }
};

InterStella_TIA.prototype.read = function(address)
{
   // Only the collision bits are actually handled in this module.
   // Technically the input ports are also the job of the TIA hardware,
   //  but we handle all the input in the core module.
   if (address === 0)      // CXM0P
      return (this.collisions.m0p1 << 7) | (this.collisions.m0p0 << 6);
   else if (address === 1) // CXM1P
      return (this.collisions.m1p0 << 7) | (this.collisions.m1p1 << 6);
   else if (address === 2) // CXP0FB
      return (this.collisions.p0pf << 7) | (this.collisions.p0bl << 6);
   else if (address === 3) // CXP1FB
      return (this.collisions.p1pf << 7) | (this.collisions.p1bl << 6);
   else if (address === 4) // CXM0FB
      return (this.collisions.m0pf << 7) | (this.collisions.m0bl << 6);
   else if (address === 5) // CXM1FB
      return (this.collisions.m1pf << 7) | (this.collisions.m1bl << 6);
   else if (address === 6) // CXBLPF
      return (this.collisions.blpf << 7);
   else if (address === 7) // CXPPMM
      return (this.collisions.p0p1 << 7) | (this.collisions.m0m1 << 6);
   else // INPT0 - INPT5
      return 0;
};

InterStella_TIA.prototype.write = function(address, value)
{
   if (address === 0)      // VSYNC
      this.vsync = (value & 0x02) >>> 1;
   else if (address === 1) // VBLANK
      this.vblank = (value & 0x80) >>> 7;
   else if (address === 2) // WSYNC
      this.wsync = true;
   else if (address === 3) // RSYNC
      ; // This is documented as a testing command; we won't do it here.
   else if (address === 4) // NUSIZ0
   {
      this.size_player_missle_0 = ((value & 0x30) >>> 4);
      this.number_player_missle_0 = value & 0x07;
   }
   else if (address === 5) // NUSIZ1
   {
      this.size_player_missle_1 = ((value & 0x30) >>> 4);
      this.number_player_missle_1 = value & 0x07;
   }
   else if (address === 6) // COLUP0
      this.color_player_missle_0 = value >>> 1;
   else if (address === 7) // COLUP1
      this.color_player_missle_1 = value >>> 1;
   else if (address === 8) // COLUPF
      this.color_playfield = value >>> 1;
   else if (address === 9) // COLUBK
      this.color_background = value >>> 1;
   else if (address === 0x0a) // CTRLPF
   {
      this.playfield_reflect = value & 0x01;
      this.playfield_score = ((value & 0x02) >>> 1);
      this.playfield_priority = ((value & 0x04) >>> 2);
      this.size_ball = ((value & 0x30) >>> 4);
   }
   else if (address === 0x0b) // REFP0
      this.reflect_player_0 = ((value & 0x08) >>> 3);
   else if (address === 0x0c) // REFP1
      this.reflect_player_1 = ((value & 0x08) >>> 3);
   else if (address === 0x0d) // PF0
      this.data_playfield = (this.data_playfield & 0x0ffff) | ((value & 0xf0) << 12);
   else if (address === 0x0e) // PF1
      this.data_playfield = (this.data_playfield & 0xf00ff) | (value << 8);
   else if (address === 0x0f) // PF2
      this.data_playfield = (this.data_playfield & 0xfff00) | value;
   else if (address === 0x10) // RESP0
      this.position_player_0 = this.beam.x;
   else if (address === 0x11) // RESP1
      this.position_player_1 = this.beam.x;
   else if (address === 0x12) // RESM0
      this.position_missle_0 = this.beam.x;
   else if (address === 0x13) // RESM1
      this.position_missle_1 = this.beam.x;
   else if (address === 0x14) // RESBL
      this.position_ball = this.beam.x;
   else if (address === 0x15) // AUDC0
      this.audio_control_0 = value & 0x0f;
   else if (address === 0x16) // AUDC1
      this.audio_control_1 = value & 0x1f;
   else if (address === 0x17) // AUDF0
      this.audio_freq_0 = value & 0x0f;
   else if (address === 0x18) // AUDF1
      this.audio_freq_1 = value & 0x0f;
   else if (address === 0x19) // AUDV0
      this.audio_vol_0 = value & 0x0f;
   else if (address === 0x1a) // AUDV1
      this.audio_vol_1 = value & 0x0f;
   else if (address === 0x1b) // GRP0
      this.data_player_0 = value;
   else if (address === 0x1c) // GRP1
      this.data_player_1 = value;
   else if (address === 0x1d) // ENAM0
      this.enable_missle_0 = ((value & 0x02) >>> 1);
   else if (address === 0x1e) // ENAM1
      this.enable_missle_1 = ((value & 0x02) >>> 1);
   else if (address === 0x1f) // ENABL
      this.enable_ball = ((value & 0x02) >>> 1);
   else if (address === 0x20) // HMP0
      this.h_motion_player_0 = ((value & 0xf0) >>> 4);
   else if (address === 0x21) // HMP1
      this.h_motion_player_1 = ((value & 0xf0) >>> 4);
   else if (address === 0x22) // HMM0
      this.h_motion_missle_0 = ((value & 0xf0) >>> 4);
   else if (address === 0x23) // HMM1
      this.h_motion_missle_1 = ((value & 0xf0) >>> 4);
   else if (address === 0x24) // HMBL
      this.h_motion_ball = ((value & 0xf0) >>> 4);
   else if (address === 0x25) // VDELP0
      this.v_delay_player_0 = value & 0x01;
   else if (address === 0x26) // VDELP1
      this.v_delay_player_1 = value & 0x01;
   else if (address === 0x27) // VDELBL
      this.v_delay_ball = value & 0x01;
   else if (address === 0x28) // RESMP0
      this.reset_missle_0 = ((value & 0x02) >>> 1);
   else if (address === 0x29) // RESMP1
      this.reset_missle_1 = ((value & 0x02) >>> 1);
   else if (address === 0x2a) // HMOVE
   {
      // Apply horizontal motion
      // First convert the given value to a signed offset.
      var offset = value >>> 4;
      if (offset & 0x08)
         offset = -((0x0f & ~offset) + 1);
      
      this.position_player_0 += offset;
      this.position_player_1 += offset;
      this.position_missle_0 += offset;
      this.position_missle_1 += offset;
      this.position_ball += offset;
   }
   else if (address === 0x2b) // HMCLR
   {
      // Clear horizontal motion registers
      this.h_motion_player_0 = this.h_motion_player_1 =
      this.h_motion_missle_0 = this.h_motion_missle_1 =
      this.h_motion_ball = 0;
   }
   else if (address === 0x2c) // CXCLR
   {
      // Clear all collision latches
      this.collisions.m0p1 = this.collisions.m0p0 = this.collisions.m1p0 =
      this.collisions.m1p1 = this.collisions.p0pf = this.collisions.p0bl =
      this.collisions.p1pf = this.collisions.p1bl = this.collisions.m0pf =
      this.collisions.m0bl = this.collisions.m1pf = this.collisions.m1bl =
      this.collisions.blpf = this.collisions.p0p1 = this.collisions.m0m1 = 0;
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
