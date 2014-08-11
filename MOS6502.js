///////////////////////////////////////////////////////////////////////////////
/// @file MOS6502.js
///
/// @brief Emulator for the MOS Technologies 6502 microprocessor
///
/// @author Matthew Howell
///
/// @remarks
///  This module is a simple, straightforward instruction interpreter.
///   There is no fancy dynamic recompilation or cycle-accurate emulation.
///   The author believes that this should be sufficient for any emulator that
///   would be feasible to write in JavaScript anyway.
///  The code and the comments in this file assume that the reader is familiar
///   with the 6502 architecture. If you're not, consult 6502.org.
///
/// @copyright (c) 2014 Matthew Howell
///  This code is released under the MIT license,
///  a copy of which is available in the associated LICENSE file,
///  or at http://opensource.org/licenses/MIT
///////////////////////////////////////////////////////////////////////////////
var MOS6502 = (function() {
"use strict";

///////////////////////////////////////////////////////////////////////////////
/// We'll begin with the object constructor and the public API functions.
///////////////////////////////////////////////////////////////////////////////
function MOS6502(core, options)
{
   // The first argument to this constructor should be an object containing 2 functions:
   // mem_read(address) should return the byte at the given memory address, and
   // mem_write(address, value) should write the given value to the given memory address.
   // If either of those functions is missing, this module cannot run.
   if (!core || (typeof core.mem_read !== "function") || (typeof core.mem_write !== "function"))
      throw("MOS6502: Core object is missing required functions.");
   
   if (this === window)
      throw("MOS6502: This function is a constructor; call it using operator new.");

   // Obviously we'll be needing the core object's functions and the other options again.
   this.core = core;
   this.options = (typeof options == "object") ? options : {};

   // There's tons of stuff in this object,
   //  but just these three functions make up the public API.
   return {
      reset : this.reset.bind(this),
      run_instruction : this.run_instruction.bind(this),
      interrupt : this.interrupt.bind(this)
   };
}

///////////////////////////////////////////////////////////////////////////////
/// @public reset
///
/// @brief Re-initialize the processor as if a reset or power on had occured.
///////////////////////////////////////////////////////////////////////////////
MOS6502.prototype.reset = function()
{
   this.a = 0;
   this.x = 0;
   this.y = 0;
   this.sp = 0xfd;
   this.pc = this.core.mem_read(0xfffc) | (this.core.mem_read(0xfffd) << 8);
   this.flags = {N:0, V:0, D:0, I:1, Z:0, C:0};
   
   this.irq_requested = false;
   this.nmi_requested = false;
   
   this.deferred_i_flag_change = false;
   this.new_i_flag_state = 0;
};

///////////////////////////////////////////////////////////////////////////////
/// @public run_instruction
///
/// @brief Executes a single instruction.
///
/// @return The number of machine cycles the instruction took to run,
///          plus any time that went into handling interrupts that fired
///          while this instruction was executing.
///////////////////////////////////////////////////////////////////////////////
MOS6502.prototype.run_instruction = function()
{
   // This table contains the number of cycles used for each opcode.
   var cycle_counts = [
   // 0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F
      7, 6, 2, 8, 3, 3, 5, 5, 3, 2, 2, 2, 4, 4, 6, 6, // 0
      2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, // 1
      6, 6, 2, 8, 3, 3, 5, 5, 4, 2, 2, 2, 4, 4, 6, 6, // 2
      2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, // 3
      6, 6, 2, 8, 3, 3, 5, 5, 3, 2, 2, 2, 3, 4, 6, 6, // 4
      2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, // 5
      6, 6, 2, 8, 3, 3, 5, 5, 4, 2, 2, 2, 5, 4, 6, 6, // 6
      2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, // 7
      2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4, // 8
      2, 6, 2, 6, 4, 4, 4, 4, 2, 5, 2, 5, 5, 5, 5, 5, // 9
      2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4, // A
      2, 5, 2, 5, 4, 4, 4, 4, 2, 4, 2, 4, 4, 4, 4, 4, // B
      2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6, // C
      2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, // D
      2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6, // E
      2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7  // F
   ];

   // Get the opcode to execute, and its associated function.
   var opcode = this.core.mem_read(this.pc),
       func = this.instructions[opcode];
  
   // Get the "normal" cycle count for this opcode.
   // The instruction function may increase this under certain circumstances.
   this.cycle_counter = cycle_counts[opcode];
   // Call the function to execute the instruction.
   func.call(this);
   // Increment the program counter to the next instruction.
   this.pc = (this.pc + 1) & 0xffff;
   
   // Handle any interrupt request that arrived during the previous instruction.
   // Poll for any interrupts that arrived during the previous instruction.
   // Do this before the CLI/SEI operation takes place,
   //  to simulate the hardware doing this poll 1 cycle into the 2 cycle instruction.
   var doing_interrupt = (this.irq_requested && !this.flags.I) || this.nmi_requested;
   
   // If that instruction wanted to modify the I flag,
   //  defer that operation until the next instruction as appropriate.
   if (this.deferred_i_flag_change)
   {
      this.flags.I = this.new_i_flag_state;
      this.deferred_i_flag_change = false;
   }
   
   // Now handle the interrupt if we have one.
   if (doing_interrupt)
   {
      // This is going to take a few more cycles.
      this.cycle_counter += 7;
      // Save off the old program counter.
      this.push_pc();
      // Clear the B flag in the thing pushed to the stack.
      this.push_byte(this.get_status_register() & ~0x10);
      // The I flag is set after the current flags are pushed.
      this.flags.I = 1;
      // Set the PC from the vector; the NMI and the normal IRQ have different vectors.
      var vector = this.nmi_requested ? 0xfffa : 0xfffe;
      this.pc = this.core.mem_read(vector) | (this.core.mem_read(vector + 1) << 8);
      // The interrupt has now been handled, it's no longer being requested,
      this.irq_requested = false;
      this.nmi_requested = false;
   }
   
   return this.cycle_counter;
};

///////////////////////////////////////////////////////////////////////////////
/// @public interrupt
///
/// @brief Simulates pulsing the processor's IRQ (or NMI) pin.
///
/// @param non_maskable - true if this is an NMI, false if a normal IRQ
///////////////////////////////////////////////////////////////////////////////
MOS6502.prototype.interrupt = function(non_maskable)
{
   if (non_maskable)
      this.nmi_requested = true;
   else
      this.irq_requested = true;
};

///////////////////////////////////////////////////////////////////////////////
/// The public API functions end here.
///
/// What begins here are just utility functions used by various instructions.
///////////////////////////////////////////////////////////////////////////////
MOS6502.prototype.get_status_register = function()
{
   return (this.flags.N << 7) |
          (this.flags.V << 6) |
          (           1 << 5) | // There is no flag at this location.
          (           1 << 4) | // This the B flag location.
          (this.flags.D << 3) |
          (this.flags.I << 2) |
          (this.flags.Z << 1) |
          (this.flags.C);
};

MOS6502.prototype.set_status_register = function(operand)
{
   this.flags.N = (operand & 0x80) >>> 7;
   this.flags.V = (operand & 0x40) >>> 6;
   this.flags.D = (operand & 0x08) >>> 3;
   this.flags.I = (operand & 0x04) >>> 2;
   this.flags.Z = (operand & 0x02) >>> 1;
   this.flags.C = (operand & 0x01);
};

MOS6502.prototype.push_byte = function(operand)
{
   this.core.mem_write(this.sp | 0x100, operand);
   this.sp = (this.sp - 1) & 0xff;
};

MOS6502.prototype.pop_byte = function()
{
   this.sp = (this.sp + 1) & 0xff;
   return this.core.mem_read(this.sp | 0x100);
};

MOS6502.prototype.push_pc = function(operand)
{
   this.push_byte((this.pc & 0xff00) >>> 8);
   this.push_byte(this.pc & 0x00ff);
};

MOS6502.prototype.pop_pc = function(operand)
{
   this.pc = this.pop_byte();
   this.pc |= (this.pop_byte() << 8);
};

MOS6502.prototype.set_nz_flags = function(value)
{
   this.flags.N = (value & 0x80) ? 1 : 0;
   this.flags.Z = (value === 0) ? 1 : 0;
};

///////////////////////////////////////////////////////////////////////////////
/// The way most instructions work in this emulator is that they set up
///  their operands according to their addressing mode, and then they call a
///  utility function that handles all variations of that instruction.
/// Those utility functions begin here.
///////////////////////////////////////////////////////////////////////////////
MOS6502.prototype.do_relative_branch = function(test)
{
   // Advance the PC to the operand in any case.
   this.pc = (this.pc + 1) & 0xffff;

   if (test)
   {
      // Taking a branch always uses one extra cycle.
      this.cycle_counter++;
   
      // Create a signed offset from the unsigned byte we read from memory.
      var offset = this.core.mem_read(this.pc);
      if (offset & 0x80)
      {
         offset = -((0xff & ~offset) + 1);
      }
      
      // If the PC is crossing a page boundary, that's one more cycle.
      if (((this.pc + 1) ^ (this.pc + 1 + offset)) & 0x100)
      {
         this.cycle_counter++;
      }
      
      // Finally actually set the new PC.
      this.pc = (this.pc + offset) & 0xffff;
   }
};

MOS6502.prototype.do_asl = function(address)
{
   // Address being undefined means the operand is the accumulator; it's a memory byte otherwise.
   var operand = (address === undefined) ? this.a : this.core.mem_read(address);
   this.flags.C = (operand & 0x80) ? 1 : 0;
   operand = (operand << 1) & 0xff;
   this.set_nz_flags(operand);
   
   if (address === undefined)
      this.a = operand;
   else
      this.core.mem_write(address, operand);
};

MOS6502.prototype.do_lsr = function(address)
{
   // Address being undefined means the operand is the accumulator; it's a memory byte otherwise.
   var operand = (address === undefined) ? this.a : this.core.mem_read(address);
   this.flags.C = (operand & 0x01) ? 1 : 0;
   operand = (operand >>> 1) & 0xff;
   this.flags.N = 0;
   this.flags.Z = (operand === 0) ? 1 : 0;
   
   if (address === undefined)
      this.a = operand;
   else
      this.core.mem_write(address, operand);
};

MOS6502.prototype.do_rol = function(address)
{
   // Address being undefined means the operand is the accumulator; it's a memory byte otherwise.
   var operand = (address === undefined) ? this.a : this.core.mem_read(address);
   var temp = this.flags.C ? 1 : 0;
   this.flags.C = (operand & 0x80) ? 1 : 0;
   operand = (operand << 1) & 0xff;
   operand |= temp;
   this.set_nz_flags(operand);
   
   if (address === undefined)
      this.a = operand;
   else
      this.core.mem_write(address, operand);
};

MOS6502.prototype.do_ror = function(address)
{
   // Address being undefined means the operand is the accumulator; it's a memory byte otherwise.
   var operand = (address === undefined) ? this.a : this.core.mem_read(address);
   var temp = this.flags.C ? 1 : 0;
   this.flags.C = (operand & 0x01) ? 1 : 0;
   operand = (operand >>> 1) & 0xff;
   operand |= (temp << 7);
   this.flags.N = temp;
   this.flags.Z = (operand === 0) ? 1 : 0;
   
   if (address === undefined)
      this.a = operand;
   else
      this.core.mem_write(address, operand);
};

MOS6502.prototype.do_bit = function(operand)
{
   this.flags.N = (operand & 0x80) ? 1 : 0;
   this.flags.V = (operand & 0x40) ? 1 : 0;
   this.flags.Z = (operand & this.a) ? 0 : 1;
};

MOS6502.prototype.do_ora = function(operand)
{
   this.a |= operand;
   this.set_nz_flags(this.a);
};

MOS6502.prototype.do_and = function(operand)
{
   this.a &= operand;
   this.set_nz_flags(this.a);
};

MOS6502.prototype.do_eor = function(operand)
{
   this.a ^= operand;
   this.set_nz_flags(this.a);
};

MOS6502.prototype.do_adc = function(operand)
{
   // This instruction behaves totally differently in decimal mode.
   // Decimal mode does not exist if we're an NES this right now.
   if (this.flags.D && !this.options.nes_mode)
   {
      // In decimal mode, we have to add each decimal digit separately,
      //  and then manually carry a 1 if that's needed.
      var lo = (this.a & 0x0f) + (operand & 0x0f) + this.flags.C;
      var hi = (this.a & 0xf0) + (operand & 0xf0);
      // Set the zero flag before the manual carry operation.
      this.flags.Z = ((lo + hi) & 0xff) ? 0 : 1;
      if (lo > 0x09)
      {
         lo += 0x06;
         hi += 0x10;
      }

      // The sign and overflow flags are evaluated before the high digit is wrapped.
      this.flags.N = (hi & 0x80) ? 1 : 0;
      this.flags.V = (~(this.a ^ operand) & (this.a ^ hi) & 0x80) ? 1 : 0;
      
      // If the high digit overflowed in decimal terms, manually wrap it around.
      if (hi > 0x90)
      {
         hi += 0x60;
      }
      
      // Evaluate the new carry flag, now that all the math is done.
      this.flags.C = (hi & 0xff00) ? 1 : 0;
      
      // Finally, combine the two digits into the actual result.
      this.a = (lo & 0x0f) | (hi & 0xf0);
   }
   else
   {
      // Do the addition natively first, so that overflow can be spotted easily.
      var result = (this.a & 0xff) + (operand & 0xff) + this.flags.C;
      
      // If the sign bit is different before the addition from what it is
      //  after the addition AND the sign bits of the accumulator and 
      //  the operand were initially the same, then set the overflow flag.
      this.flags.V = (~(this.a ^ operand) & (this.a ^ result) & 0x80) ? 1 : 0;
      // Set the new carry flag, if we ended up going past eight bits.
      this.flags.C = (result & 0xff00) ? 1 : 0;
      
      // Now make sure we don't stray past eight bits.
      this.a = result & 0xff;
      
      // Set the remaining flags.
      this.set_nz_flags(this.a);
   }
};

MOS6502.prototype.do_sta = function(address)
{
   this.core.mem_write(address, this.a);
};

MOS6502.prototype.do_stx = function(address)
{
   this.core.mem_write(address, this.x);
};

MOS6502.prototype.do_sty = function(address)
{
   this.core.mem_write(address, this.y);
};

MOS6502.prototype.do_lda = function(operand)
{
   this.a = operand;
   this.set_nz_flags(this.a);
};

MOS6502.prototype.do_ldx = function(operand)
{
   this.x = operand;
   this.set_nz_flags(this.x);
};

MOS6502.prototype.do_ldy = function(operand)
{
   this.y = operand;
   this.set_nz_flags(this.y);
};

MOS6502.prototype.do_cmp = function(operand)
{
   var result = this.a - operand;
   this.set_nz_flags(result);
   this.flags.C = (operand <= this.a) ? 1 : 0;
};

MOS6502.prototype.do_cpx = function(operand)
{
   var result = this.x - operand;
   this.set_nz_flags(result);
   this.flags.C = (operand <= this.x) ? 1 : 0;
};

MOS6502.prototype.do_cpy = function(operand)
{
   var result = this.y - operand;
   this.set_nz_flags(result);
   this.flags.C = (operand <= this.y) ? 1 : 0;
};

MOS6502.prototype.do_sbc = function(operand)
{
   // Clamp the two operands at 8 bits.
   this.a &= 0xff;
   operand &= 0xff;
   
   // Calculate the result of the subtraction, for binary mode.
   // In decimal mode, we'll only use this to get flags.
   var result = this.a - operand - (this.flags.C ? 0 : 1);
   // If the sign bit is different before the subtraction from what it is
   //  after the subtraction AND the sign bits of the accumulator and 
   //  the operand were initially the same, then set the overflow flag.
   this.flags.V = ((this.a ^ operand) & (this.a ^ result) & 0x80) ? 1 : 0;
   // Set the remaining flags except C, since none of the flags care what the mode is.
   this.set_nz_flags(result & 0xff);

   // This instruction behaves very differently in decimal mode.
   // Decimal mode does not exist if we're an NES this right now.
   if (this.flags.D && !this.options.nes_mode)
   {
      // We have to subtract each decimal digit separately,
      //  and then manually borrow a 1 if that's needed.
      var lo = (this.a & 0x0f) - (operand & 0x0f) - (this.flags.C ? 0 : 1);
      var hi = (this.a & 0xf0) - (operand & 0xf0);
      if (lo & 0x10)
      {
         lo -= 0x06;
         hi -= 0x01;
      }

      // If the high digit overflowed in decimal terms, manually wrap it around.
      if (hi & 0x100)
      {
         hi -= 0x60;
      }
      
      // Finally, update the accumulator with each digit of the result.
      this.a = (lo & 0x0f) | (hi & 0xf0);
   }
   else
   {
      // Make sure we didn't underflow and get way too many bits set.
      this.a = result & 0xff;
   }
   
   // Save carry for last, because it's used in the decimal mode calculation.
   // Set the carry flag, if we ended up *not* borrowing.
   this.flags.C = (result & 0xff00) ? 0 : 1;
};

MOS6502.prototype.do_inc = function(address)
{
   var operand = this.core.mem_read(address);
   operand = (operand + 1) & 0xff;
   this.set_nz_flags(operand);
   this.core.mem_write(address, operand);
};

MOS6502.prototype.do_dec = function(address)
{
   var operand = this.core.mem_read(address);
   operand = (operand - 1) & 0xff;
   this.set_nz_flags(operand);
   this.core.mem_write(address, operand);
};

// These functions handle the undocumented instructions.
MOS6502.prototype.do_sax = function(address)
{
   this.core.mem_write(address, this.a & this.x);
};
MOS6502.prototype.do_lax = function(operand)
{
   this.do_lda(operand);
   this.do_ldx(operand);
};
MOS6502.prototype.do_dcp = function(address)
{
   this.do_dec(address);
   this.do_cmp(this.core.mem_read(address));
};
MOS6502.prototype.do_ins = function(address)
{
   this.do_inc(address);
   this.do_sbc(this.core.mem_read(address));
};
MOS6502.prototype.do_aso = function(address)
{
   this.do_asl(address);
   this.do_ora(this.core.mem_read(address));
};
MOS6502.prototype.do_rla = function(address)
{
   this.do_rol(address);
   this.do_and(this.core.mem_read(address));
};
MOS6502.prototype.do_lse = function(address)
{
   this.do_lsr(address);
   this.do_eor(this.core.mem_read(address));
};
MOS6502.prototype.do_rra = function(address)
{
   this.do_ror(address);
   this.do_adc(this.core.mem_read(address));
};
MOS6502.prototype.do_anc = function(operand)
{
   this.do_and(operand);
   this.flags.C = this.flags.N;
};
MOS6502.prototype.do_alr = function(operand)
{
   this.do_and(operand);
   this.do_lsr();
};
MOS6502.prototype.do_arr = function(operand)
{
   this.do_and(operand);
   this.do_ror();
};
MOS6502.prototype.do_xaa = function(operand)
{
   this.a = this.x;
   this.do_and(operand);
};
MOS6502.prototype.do_oal = function(operand)
{
   this.do_ora(0xee);
   this.do_and(operand);
   this.x = this.a;
};
MOS6502.prototype.do_axs = function(operand)
{
   var temp = this.a & this.x;
   temp -= operand;
   this.flags.C = (temp > 0) ? 1 : 0;
   this.x = temp & 0xff;
};
MOS6502.prototype.do_las = function(operand)
{
   this.sp &= operand & 0xff;
   this.a = this.x = this.sp;
   this.set_nz_flags(this.sp);
};
MOS6502.prototype.do_kill = function()
{
   console.log("Got kill instruction at PC=" + this.pc.toString(16));
};
MOS6502.prototype.do_unstable = function()
{
   console.log("Got unstable instruction at PC=" + this.pc.toString(16));
};

///////////////////////////////////////////////////////////////////////////////
/// These functions handle getting the operand for each addressing mode.
///////////////////////////////////////////////////////////////////////////////
MOS6502.prototype.get_imm8_operand = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   return this.core.mem_read(this.pc);
};

// This isn't a real addressing mode, it's used for instructions that
//  operand on a memory address in place, so the real argument
//  to the instruction is the address, not the value at the address.
MOS6502.prototype.get_imm16_operand = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate_lo = this.core.mem_read(this.pc);
   this.pc = (this.pc + 1) & 0xffff;
   var immediate_hi = this.core.mem_read(this.pc);
   return immediate_lo | (immediate_hi << 8);   
};

MOS6502.prototype.get_zero_page_operand = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate = this.core.mem_read(this.pc);
   return this.core.mem_read(immediate);
};

MOS6502.prototype.get_zero_page_x_operand = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate = this.core.mem_read(this.pc);
   return this.core.mem_read((immediate + this.x) & 0xff);
};

MOS6502.prototype.get_zero_page_y_operand = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate = this.core.mem_read(this.pc);
   return this.core.mem_read((immediate + this.y) & 0xff);
};

MOS6502.prototype.get_absolute_operand = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate_lo = this.core.mem_read(this.pc);
   this.pc = (this.pc + 1) & 0xffff;
   var immediate_hi = this.core.mem_read(this.pc);
   return this.core.mem_read(immediate_lo | (immediate_hi << 8));
};

MOS6502.prototype.get_absolute_x_operand = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate_lo = this.core.mem_read(this.pc);
   this.pc = (this.pc + 1) & 0xffff;
   var immediate_hi = this.core.mem_read(this.pc),
       base_address = (immediate_lo | (immediate_hi << 8)),
       operand = this.core.mem_read(base_address + this.x);
       
   // Add one cycle if our read crossed a page boundary.
   if ((this.x + (base_address & 0xff)) >= 0x100)
      this.cycle_counter++;
   
   return operand;
};

MOS6502.prototype.get_absolute_y_operand = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate_lo = this.core.mem_read(this.pc);
   this.pc = (this.pc + 1) & 0xffff;
   var immediate_hi = this.core.mem_read(this.pc),
       base_address = (immediate_lo | (immediate_hi << 8)),
       operand = this.core.mem_read(base_address + this.y);
       
   // Add one cycle if our read crossed a page boundary.
   if ((this.y + (base_address & 0xff)) >= 0x100)
      this.cycle_counter++;
   
   return operand;
};

MOS6502.prototype.get_indirect_x_operand = function()
{
   return this.core.mem_read(this.get_indirect_x_address());
};

MOS6502.prototype.get_indirect_y_operand = function()
{
   return this.core.mem_read(this.get_indirect_y_address());
};

// These two modes are used only by some of the undocumented instructions.
MOS6502.prototype.get_indirect_x_address = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate = this.core.mem_read(this.pc),
       address = this.core.mem_read((immediate + this.x) & 0xff) |
                (this.core.mem_read((immediate + this.x + 1) & 0xff) << 8);
   return address;
};
MOS6502.prototype.get_indirect_y_address = function()
{
   this.pc = (this.pc + 1) & 0xffff;
   var immediate = this.core.mem_read(this.pc),
       base_address = this.core.mem_read(immediate) | (this.core.mem_read((immediate + 1) & 0xff) << 8),
       address = this.y + base_address;
       
   // Add one cycle if our read crossed a page boundary.
   if (((base_address & 0xff) + this.y) >= 0x100)
      this.cycle_counter++;
   
   return address & 0xffff;
};

///////////////////////////////////////////////////////////////////////////////
/// This table contains the implementations for all instructions.
/// Most of them simply call some combination of the functions above.
/// Note that several undocumented instructions overwrite the cycle counter,
///  because they call functions that add oops cycles that the undocumented
///  instructions are not actually subject to.
///////////////////////////////////////////////////////////////////////////////
MOS6502.prototype.instructions = [
/* BRK */ function() {
   // BRK doesn't push 1+ itself like you would expect, instead it pushes one more than that.
   this.pc = (this.pc + 2) & 0xffff;
   this.push_pc();
   // The B flag needs to be set in the thing we push onto the stack here.
   this.push_byte(this.get_status_register());
   // The I flag is set after the current flags are pushed.
   this.flags.I = 1;
   this.pc = ((this.core.mem_read(0xfffe) | (this.core.mem_read(0xffff) << 8)) - 1) & 0xffff;
},
/* ORA ($BB, X) */ function() { this.do_ora(this.get_indirect_x_operand()); },
/* Kill */ function() { this.do_kill(); },
/* ASO ($BB, X) (Undocumented) */ function() { this.do_aso(this.get_indirect_x_address()); },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* ORA $LL */ function() { this.do_ora(this.get_zero_page_operand()); },
/* ASL $LL */ function() { this.do_asl(this.get_imm8_operand()); },
/* ASO $LL (Undocumented) */ function() { this.do_aso(this.get_imm8_operand()); },
/* PHP */ function() { this.push_byte(this.get_status_register()); },
/* ORA #$BB */ function() { this.do_ora(this.get_imm8_operand()); },
/* ASL A */ function() { this.do_asl(); },
/* ANC #$BB (Undocumented) */ function() { this.do_anc(this.get_imm8_operand()); },
/* Three-byte NOP (Undocumented) */ MOS6502.prototype.get_imm16_operand,
/* ORA $HHLL */ function() { this.do_ora(this.get_absolute_operand()); },
/* ASL $HHLL */ function() { this.do_asl(this.get_imm16_operand()); },
/* ASO $HHLL (Undocumented) */ function() { this.do_aso(this.get_imm16_operand()); },
/* BPL $BB */ function() { this.do_relative_branch(this.flags.N === 0); },
/* ORA ($LL), Y */ function() { this.do_ora(this.get_indirect_y_operand()); },
/* Kill */ function() { this.do_kill(); },
/* ASO ($LL), Y (Undocumented) */ function() { this.do_aso(this.get_indirect_y_address());
                                               this.cycle_counter = 8; },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* ORA $LL, X */ function() { this.do_ora(this.get_zero_page_x_operand()); },
/* ASL $LL, X */ function() { this.do_asl((this.get_imm8_operand() + this.x) & 0xff); },
/* ASO $LL, X (Undocumented) */ function() { this.do_aso((this.get_imm8_operand() + this.x) & 0xff); },
/* CLC */ function() { this.flags.C = 0; },
/* ORA $HHLL, Y */ function() { this.do_ora(this.get_absolute_y_operand()); },
/* NOP (Undocumented) */ function() { },
/* ASO $HHLL, Y (Undocumented) */ function() { this.do_aso((this.get_imm16_operand() + this.y) & 0xffff); },
/* Three-byte NOP (Undocumented) */ MOS6502.prototype.get_absolute_x_operand,
/* ORA $HHLL, X */ function() { this.do_ora(this.get_absolute_x_operand()); },
/* ASL $HHLL, X */ function() { this.do_asl((this.get_imm16_operand() + this.x) & 0xffff); },
/* ASO $HHLL, X (Undocumented) */ function() { this.do_aso((this.get_imm16_operand() + this.x) & 0xffff); },
/* JSR $HHLL */ function() { var address = this.get_imm16_operand(); this.push_pc(); this.pc = address - 1; },
/* AND ($BB, X) */ function() { this.do_and(this.get_indirect_x_operand()); },
/* Kill */ function() { this.do_kill(); },
/* RLA ($BB, X) (Undocumented) */ function() { this.do_rla(this.get_indirect_x_address()); },
/* BIT $LL */ function() { this.do_bit(this.get_zero_page_operand()); },
/* AND $LL */ function() { this.do_and(this.get_zero_page_operand()); },
/* ROL $LL */ function() { this.do_rol(this.get_imm8_operand()); },
/* RLA $LL (Undocumented) */ function() { this.do_rla(this.get_imm8_operand()); },
/* PLP */ function() {
   // Store the current state of the I flag, so we can defer changing it to the new value.
   var old_i_flag = this.flags.I;
   
   // Set the new flags, including the I flag.
   this.set_status_register(this.pop_byte());
   
   // Store the new I flag value, but overwrite it with the old one until later.
   this.deferred_i_flag_change = true;
   this.new_i_flag_state = this.flags.I;
   this.flags.I = old_i_flag;
},
/* AND #$BB */ function() { this.do_and(this.get_imm8_operand()); },
/* ROL A */ function() { this.do_rol(); },
/* ANC #$BB (Undocumented) */ function() { this.do_anc(this.get_imm8_operand()); },
/* BIT $HHLL */ function() { this.do_bit(this.get_absolute_operand()); },
/* AND $HHLL */ function() { this.do_and(this.get_absolute_operand()); },
/* ROL $HHLL */ function() { this.do_rol(this.get_imm16_operand()); },
/* RLA $HHLL (Undocumented) */ function() { this.do_rla(this.get_imm16_operand()); },
/* BMI $BB */ function() { this.do_relative_branch(this.flags.N === 1); },
/* AND ($LL), Y */ function() { this.do_and(this.get_indirect_y_operand()); },
/* Kill */ function() { this.do_kill(); },
/* RLA ($LL), Y (Undocumented) */ function() { this.do_rla(this.get_indirect_y_address()); 
                                               this.cycle_counter = 8;},
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* AND $LL, X */ function() { this.do_and(this.get_zero_page_x_operand()); },
/* ROL $LL, X */ function() { this.do_rol((this.get_imm8_operand() + this.x) & 0xff); },
/* RLA $LL, X (Undocumented) */ function() { this.do_rla((this.get_imm8_operand() + this.x) & 0xff); },
/* SEC */ function() { this.flags.C = 1; },
/* AND $HHLL, Y */ function() { this.do_and(this.get_absolute_y_operand()); },
/* NOP (Undocumented) */ function() { },
/* RLA $HHLL, Y (Undocumented) */ function() { this.do_rla((this.get_imm16_operand() + this.y) & 0xffff); },
/* Three-byte NOP (Undocumented) */ MOS6502.prototype.get_absolute_x_operand,
/* AND $HHLL, X */ function() { this.do_and(this.get_absolute_x_operand()); },
/* ROL $HHLL, X */ function() { this.do_rol((this.get_imm16_operand() + this.x) & 0xffff); },
/* RLA $HHLL, X (Undocumented) */ function() { this.do_rla((this.get_imm16_operand() + this.x) & 0xffff); },
/* RTI */ function() {
   this.set_status_register(this.pop_byte());
   this.pop_pc();
   this.pc = (this.pc - 1) & 0xffff;
},
/* EOR ($LL, X) */ function() { this.do_eor(this.get_indirect_x_operand()); },
/* Kill */ function() { this.do_kill(); },
/* LSE ($BB, X) (Undocumented) */ function() { this.do_lse(this.get_indirect_x_address()); },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* EOR $LL */ function() { this.do_eor(this.get_zero_page_operand()); },
/* LSR $LL */ function() { this.do_lsr(this.get_imm8_operand()); },
/* LSE $LL (Undocumented) */ function() { this.do_lse(this.get_imm8_operand()); },
/* PHA */ function() { this.push_byte(this.a); },
/* EOR #$BB */ function() { this.do_eor(this.get_imm8_operand()); },
/* LSR A */ function() { this.do_lsr(); },
/* ALR #$BB (Undocumented) */ function() { this.do_alr(this.get_imm8_operand()); },
/* JMP $HHLL */ function() { this.pc = (this.get_imm16_operand() - 1) & 0xffff; },
/* EOR $HHLL */ function() { this.do_eor(this.get_absolute_operand()); },
/* LSR $HHLL */ function() { this.do_lsr(this.get_imm16_operand()); },
/* LSE $HHLL (Undocumented) */ function() { this.do_lse(this.get_imm16_operand()); },
/* BVC $BB */ function() { this.do_relative_branch(this.flags.V === 0); },
/* EOR ($LL), Y */ function() { this.do_eor(this.get_indirect_y_operand()); },
/* Kill */ function() { this.do_kill(); },
/* LSE ($LL), Y (Undocumented) */ function() { this.do_lse(this.get_indirect_y_address()); 
                                               this.cycle_counter = 8;},
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* EOR $LL, X */ function() { this.do_eor(this.get_zero_page_x_operand()); },
/* LSR $LL, X */ function() { this.do_lsr((this.get_imm8_operand() + this.x) & 0xff); },
/* LSE $LL, X (Undocumented) */ function() { this.do_lse((this.get_imm8_operand() + this.x) & 0xff); },
/* CLI */ function() { this.deferred_i_flag_change = true; this.new_i_flag_state = 0; },
/* EOR $HHLL, Y */ function() { this.do_eor(this.get_absolute_y_operand()); },
/* NOP (Undocumented) */ function() { },
/* LSE $HHLL, Y (Undocumented) */ function() { this.do_lse((this.get_imm16_operand() + this.y) & 0xffff); },
/* Three-byte NOP (Undocumented) */ MOS6502.prototype.get_absolute_x_operand,
/* EOR $HHLL, X */ function() { this.do_eor(this.get_absolute_x_operand()); },
/* LSR $HHLL, X */ function() { this.do_lsr((this.get_imm16_operand() + this.x) & 0xffff); },
/* LSE $HHLL, X (Undocumented) */ function() { this.do_lse((this.get_imm16_operand() + this.x) & 0xffff); },
/* RTS */ function() { this.pop_pc(); },
/* ADC ($LL, X) */ function() { this.do_adc(this.get_indirect_x_operand()); },
/* Kill */ MOS6502.prototype.do_kill,
/* RRA ($BB, X) (Undocumented) */ function() { this.do_rra(this.get_indirect_x_address()); },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* ADC $LL */ function() { this.do_adc(this.get_zero_page_operand()); },
/* ROR $LL */ function() { this.do_ror(this.get_imm8_operand()); },
/* RRA $LL (Undocumented) */ function() { this.do_rra(this.get_imm8_operand()); },
/* PLA */ function() { this.a = this.pop_byte(); this.set_nz_flags(this.a); },
/* ADC #$BB */ function() { this.do_adc(this.get_imm8_operand()); },
/* ROR A */ function() { this.do_ror(); },
/* ARR #$BB (Undocumented) */ function() { this.do_arr(this.get_imm8_operand()); },
/* JMP ($HHLL) */ function() {
   var immediate_lo = this.core.mem_read(this.pc + 1),
       immediate_hi = this.core.mem_read(this.pc + 2),
       address = immediate_lo | (immediate_hi << 8),
       incremented_immediate_lo = (immediate_lo + 1) & 0xff,
       incremented_address = incremented_immediate_lo | (immediate_hi << 8);
   this.pc = ((this.core.mem_read(address) | (this.core.mem_read(incremented_address) << 8)) - 1) & 0xffff;
},
/* ADC $HHLL */ function() { this.do_adc(this.get_absolute_operand()); },
/* ROR $HHLL */ function() { this.do_ror(this.get_imm16_operand()); },
/* RRA $HHLL (Undocumented) */ function() { this.do_rra(this.get_imm16_operand()); },
/* BVS $BB */ function() { this.do_relative_branch(this.flags.V === 1); },
/* ADC ($LL), Y */ function() { this.do_adc(this.get_indirect_y_operand()); },
/* Kill */ function() { this.do_kill(); },
/* RRA ($LL), Y (Undocumented) */ function() { this.do_rra(this.get_indirect_y_address()); 
                                               this.cycle_counter = 8;},
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* ADC $LL, X */ function() { this.do_adc(this.get_zero_page_x_operand()); },
/* ROR $LL, X */ function() { this.do_ror((this.get_imm8_operand() + this.x) & 0xff); },
/* RRA $LL, X (Undocumented) */ function() { this.do_rra((this.get_imm8_operand() + this.x) & 0xff); },
/* SEI */ function() { this.deferred_i_flag_change = true; this.new_i_flag_state = 1; },
/* ADC $HHLL, Y */ function() { this.do_adc(this.get_absolute_y_operand()); },
/* NOP (Undocumented) */ function() { },
/* RRA $HHLL, Y (Undocumented) */ function() { this.do_rra((this.get_imm16_operand() + this.y) & 0xffff); },
/* Three-byte NOP (Undocumented) */ MOS6502.prototype.get_absolute_x_operand,
/* ADC $HHLL, X */ function() { this.do_adc(this.get_absolute_x_operand()); },
/* ROR $HHLL, X */ function() { this.do_ror((this.get_imm16_operand() + this.x) & 0xffff); },
/* RRA $HHLL, X (Undocumented) */ function() { this.do_rra((this.get_imm16_operand() + this.x) & 0xffff); },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* STA ($LL, X) */ function() { this.do_sta(this.get_indirect_x_address()); },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* SAX ($BB, X) (Undocumented) */ function() { this.do_sax(this.get_indirect_x_address()); },
/* STY $LL */ function() { this.do_sty(this.get_imm8_operand()); },
/* STA $LL */ function() { this.do_sta(this.get_imm8_operand()); },
/* STX $LL */ function() { this.do_stx(this.get_imm8_operand()); },
/* SAX $LL (Undocumented) */ function() { this.do_sax(this.get_imm8_operand()); },
/* DEY */ function() { this.y = (this.y - 1) & 0xff; this.set_nz_flags(this.y); },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* TXA */ function() { this.a = this.x; this.set_nz_flags(this.a); },
/* XAA #$BB (Undocumented) */ function() { this.do_xaa(this.get_imm8_operand()); },
/* STY $HHLL */ function() { this.do_sty(this.get_imm16_operand()); },
/* STA $HHLL */ function() { this.do_sta(this.get_imm16_operand()); },
/* STX $HHLL */ function() { this.do_stx(this.get_imm16_operand()); },
/* SAX $HHLL (Undocumented) */ function() { this.do_sax(this.get_imm16_operand()); },
/* BCC $BB */ function() { this.do_relative_branch(this.flags.C === 0); },
/* STA ($LL), Y */ function() { this.do_sta(this.get_indirect_y_address()); this.cycle_counter = 6; },
/* Kill */ function() { this.do_kill(); },
/* Two-byte Unstable */ function() { this.do_unstable(); this.pc = (this.pc + 1) & 0xffff; },
/* STY $LL, X */ function() { this.do_sty((this.get_imm8_operand() + this.x) & 0xff); },
/* STA $LL, X */ function() { this.do_sta((this.get_imm8_operand() + this.x) & 0xff); },
/* STX $LL, Y */ function() { this.do_stx((this.get_imm8_operand() + this.y) & 0xff); },
/* SAX $LL, Y (Undocumented) */ function() { this.do_sax((this.get_imm8_operand() + this.y) & 0xff); },
/* TYA */ function() { this.a = this.y; this.set_nz_flags(this.a); },
/* STA $HHLL, Y */ function() { this.do_sta((this.get_imm16_operand() + this.y) & 0xffff); },
/* TXS */ function() { this.sp = this.x; },
/* Three-byte Unstable */ function() { this.do_unstable(); this.pc = (this.pc + 2) & 0xffff; },
/* Three-byte Unstable */ function() { this.do_unstable(); this.pc = (this.pc + 2) & 0xffff; },
/* STA $HHLL, X */ function() { this.do_sta((this.get_imm16_operand() + this.x) & 0xffff); },
/* Three-byte Unstable */ function() { this.do_unstable(); this.pc = (this.pc + 2) & 0xffff; },
/* Three-byte Unstable */ function() { this.do_unstable(); this.pc = (this.pc + 2) & 0xffff; },
/* LDY #$BB */ function() { this.do_ldy(this.get_imm8_operand()); },
/* LDA ($BB, X) */ function() { this.do_lda(this.get_indirect_x_operand()); },
/* LDX #$BB */ function() { this.do_ldx(this.get_imm8_operand()); },
/* LAX ($BB, X) (Undocumented) */ function() { this.do_lax(this.get_indirect_x_operand()); },
/* LDY $LL */ function() { this.do_ldy(this.get_zero_page_operand()); },
/* LDA $LL */ function() { this.do_lda(this.get_zero_page_operand()); },
/* LDX $LL */ function() { this.do_ldx(this.get_zero_page_operand()); },
/* LAX $LL (Undocumented) */ function() { this.do_lax(this.get_zero_page_operand()); },
/* TAY */ function() { this.y = this.a; this.set_nz_flags(this.y); },
/* LDA #$BB */ function() { this.do_lda(this.get_imm8_operand()); },
/* TAX */ function() { this.x = this.a; this.set_nz_flags(this.x); },
/* OAL #$BB (Undocumented) */ function() { this.do_oal(this.get_imm8_operand()); },
/* LDY $HHLL */ function() { this.do_ldy(this.get_absolute_operand()); },
/* LDA $HHLL */ function() { this.do_lda(this.get_absolute_operand()); },
/* LDX $HHLL */ function() { this.do_ldx(this.get_absolute_operand()); },
/* LAX $HHLL (Undocumented) */ function() { this.do_lax(this.get_absolute_operand()); },
/* BCS $BB */ function() { this.do_relative_branch(this.flags.C === 1); },
/* LDA ($LL), Y */ function() { this.do_lda(this.get_indirect_y_operand()); },
/* Kill */ function() { this.do_kill(); },
/* LAX ($LL), Y (Undocumented) */ function() { this.do_lax(this.get_indirect_y_operand()); },
/* LDY $LL, X */ function() { this.do_ldy(this.get_zero_page_x_operand()); },
/* LDA $LL, X */ function() { this.do_lda(this.get_zero_page_x_operand()); },
/* LDX $LL, Y */ function() { this.do_ldx(this.get_zero_page_y_operand()); },
/* LAX $LL, Y (Undocumented) */ function() { this.do_lax(this.get_zero_page_y_operand()); },
/* CLV */ function() { this.flags.V = 0; },
/* LDA $HHLL, Y */ function() { this.do_lda(this.get_absolute_y_operand()); },
/* TSX */ function() { this.x = this.sp; this.set_nz_flags(this.x); },
/* LAS $HHLL, Y (Undocumented) */ function() { this.do_las(this.get_absolute_y_operand()); },
/* LDY $HHLL, X */ function() { this.do_ldy(this.get_absolute_x_operand()); },
/* LDA $HHLL, X */ function() { this.do_lda(this.get_absolute_x_operand()); },
/* LDX $HHLL, Y */ function() { this.do_ldx(this.get_absolute_y_operand()); },
/* LAX $HHLL, Y (Undocumented) */ function() { this.do_lax(this.get_absolute_y_operand()); },
/* CPY #$BB */ function() { this.do_cpy(this.get_imm8_operand()); },
/* CMP ($BB, X) */ function() { this.do_cmp(this.get_indirect_x_operand()); },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* DCP ($BB, X) (Undocumented) */ function() { this.do_dcp(this.get_indirect_x_address()); },
/* CPY $LL */ function() { this.do_cpy(this.get_zero_page_operand()); },
/* CMP $LL */ function() { this.do_cmp(this.get_zero_page_operand()); },
/* DEC $LL */ function() { this.do_dec(this.get_imm8_operand()); },
/* DCP $LL (Undocumented) */ function() { this.do_dcp(this.get_imm8_operand()); },
/* INY */ function() { this.y = (this.y + 1) & 0xff; this.set_nz_flags(this.y); },
/* CMP #$BB */ function() { this.do_cmp(this.get_imm8_operand()); },
/* DEX */ function() { this.x = (this.x - 1) & 0xff; this.set_nz_flags(this.x); },
/* AXS #$BB (Undocumented) */ function() { this.do_axs(this.get_imm8_operand()); },
/* CPY $HHLL */ function() { this.do_cpy(this.get_absolute_operand()); },
/* CMP $HHLL */ function() { this.do_cmp(this.get_absolute_operand()); },
/* DEC $HHLL */ function() { this.do_dec(this.get_imm16_operand()); },
/* DCP $HHLL (Undocumented) */ function() { this.do_dcp(this.get_imm16_operand()); },
/* BNE $BB */ function() { this.do_relative_branch(this.flags.Z === 0); },
/* CMP ($LL), Y */ function() { this.do_cmp(this.get_indirect_y_operand()); },
/* Kill */ function() { this.do_kill(); },
/* DCP ($LL), Y (Undocumented) */ function() { this.do_dcp(this.get_indirect_y_address()); 
                                               this.cycle_counter = 8;},
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* CMP $LL, X */ function() { this.do_cmp(this.get_zero_page_x_operand()); },
/* DEC $LL, X */ function() { this.do_dec((this.get_imm8_operand() + this.x) & 0xff); },
/* DCP $LL, X (Undocumented) */ function() { this.do_dcp((this.get_imm8_operand() + this.x) & 0xff); },
/* CLD */ function() { this.flags.D = 0; },
/* CMP $HHLL, Y */ function() { this.do_cmp(this.get_absolute_y_operand()); },
/* NOP (Undocumented) */ function() { },
/* DCP $HHLL, Y (Undocumented) */ function() { this.do_dcp((this.get_imm16_operand() + this.y) & 0xffff); },
/* Three-byte NOP (Undocumented) */ MOS6502.prototype.get_absolute_x_operand,
/* CMP $HHLL, X */ function() { this.do_cmp(this.get_absolute_x_operand()); },
/* DEC $HHLL, X */ function() { this.do_dec((this.get_imm16_operand() + this.x) & 0xffff); },
/* DCP $HHLL, X (Undocumented) */ function() { this.do_dcp((this.get_imm16_operand() + this.x) & 0xffff); },
/* CPX #$BB */ function() { this.do_cpx(this.get_imm8_operand()); },
/* SBC ($BB, X) */ function() { this.do_sbc(this.get_indirect_x_operand()); },
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* INS ($BB, X) (Undocumented) */ function() { this.do_ins(this.get_indirect_x_address()); },
/* CPX $LL */ function() { this.do_cpx(this.get_zero_page_operand()); },
/* SBC $LL */ function() { this.do_sbc(this.get_zero_page_operand()); },
/* INC $LL */ function() { this.do_inc(this.get_imm8_operand()); },
/* INS $LL (Undocumented) */ function() { this.do_ins(this.get_imm8_operand()); },
/* INX */ function() { this.x = (this.x + 1) & 0xff; this.set_nz_flags(this.x); },
/* SBC #$BB */ function() { this.do_sbc(this.get_imm8_operand()); },
/* NOP */ function() { },
/* SBC #$BB (Undocumented) */ function() { this.do_sbc(this.get_imm8_operand()); },
/* CPX $HHLL */ function() { this.do_cpx(this.get_absolute_operand()); },
/* SBC $HHLL */ function() { this.do_sbc(this.get_absolute_operand()); },
/* INC $HHLL */ function() { this.do_inc(this.get_imm16_operand()); },
/* INS $HHLL (Undocumented) */ function() { this.do_ins(this.get_imm16_operand()); },
/* BEQ $BB */ function() { this.do_relative_branch(this.flags.Z === 1); },
/* SBC ($LL), Y */ function() { this.do_sbc(this.get_indirect_y_operand()); },
/* Kill */ function() { this.do_kill(); },
/* INS ($LL), Y (Undocumented) */ function() { this.do_ins(this.get_indirect_y_address()); 
                                               this.cycle_counter = 8;},
/* Two-byte NOP (Undocumented) */ MOS6502.prototype.get_imm8_operand,
/* SBC $LL, X */ function() { this.do_sbc(this.get_zero_page_x_operand()); },
/* INC $LL, X */ function() { this.do_inc((this.get_imm8_operand() + this.x) & 0xff); },
/* INS $LL, X (Undocumented) */ function() { this.do_ins((this.get_imm8_operand() + this.x) & 0xff); },
/* SED */ function() { this.flags.D = 1; },
/* SBC $HHLL, Y */ function() { this.do_sbc(this.get_absolute_y_operand()); },
/* NOP (Undocumented) */ function() { },
/* INS $HHLL, Y (Undocumented) */ function() { this.do_ins((this.get_imm16_operand() + this.y) & 0xffff); },
/* Three-byte NOP (Undocumented) */ MOS6502.prototype.get_absolute_x_operand,
/* SBC $HHLL, X */ function() { this.do_sbc(this.get_absolute_x_operand()); },
/* INC $HHLL, X */ function() { this.do_inc((this.get_imm16_operand() + this.x) & 0xffff); },
/* INS $HHLL, X (Undocumented) */ function() { this.do_ins((this.get_imm16_operand() + this.x) & 0xffff); }
];

// Finally, return the constructor as the export from this module.
return MOS6502;
})();
