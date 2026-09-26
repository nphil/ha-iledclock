"""Vendor colour-effect tables: `colorModeN` (device global colour-mode command,
opcode 0x13 0x03), `colorTypeN` (per-character "auto colour" text effect, used by
`getDataWithTextAutoColorProgramContent`), and the 20 built-in frame/border colour
patterns (`getDataWithFrameProgramContent`). Unlike `clock_faces.py` these are already
HEX byte-pair tokens in the vendor source (`"0F,00,0F,10,..."` or literal `add("0F")`
double-brace list entries) -- NOT decimal -- so they go through `hex_csv_to_bytes`/
`hex_tokens_to_bytes` rather than the decimal pipeline in `clock_faces.py`.
"""

from __future__ import annotations

from .hexutil import hex_csv_to_bytes, hex_tokens_to_bytes

# setColorMode's colorModeN tables (device global colour effect, opcode 0x13 0x03).
# Note: setColorMode's own dispatch logic (see commands.py) only ever actually
# *uses* COLOR_MODE_1, COLOR_MODE_9 (==10==11==12==15==16, kept once and aliased),
# COLOR_MODE_14, and the three inline literals for modes 3/4/7/8 (kept as bare bytes
# there, not worth a dict entry) -- COLOR_MODE_19..31 are bundled for completeness /
# documentation fidelity even though a real vendor bug (see commands.py docstring)
# makes them unreachable dead data for i >= 11.
COLOR_MODE_1 = hex_csv_to_bytes("0F,00,0F,10,0F,20,0F,30,0F,40,0F,50,0F,60,0F,70,0F,80,0F,90,0F,A0,0F,B0,0F,C0,0F,D0,0F,E0,\n0F,F0,0E,F0,0D,F0,0C,F0,0B,F0,0A,F0,09,F0,08,F0,07,F0,06,F0,05,F0,04,F0,03,F0,02,F0,01,F0,\n00,F0,00,F1,00,F2,00,F3,00,F4,00,F5,00,F6,00,F7,00,F8,00,F9,00,FA,00,FB,00,FC,00,FD,00,FE,\n00,FF,00,EF,00,DF,00,CF,00,BF,00,AF,00,9F,00,8F,00,7F,00,6F,00,5F,00,4F,00,3F,00,2F,00,1F,\n00,0F,01,0F,02,0F,03,0F,04,0F,05,0F,06,0F,07,0F,08,0F,09,0F,0A,0F,0B,0F,0C,0F,0D,0F,0E,0F,\n0F,0F,0F,0E,0F,0D,0F,0C,0F,0B,0F,0A,0F,09,0F,08,0F,07,0F,06,0F,05,0F,04,0F,03,0F,02,0F,01")
COLOR_MODE_2 = hex_csv_to_bytes("0F,00,0F,10,0F,20,0F,30,0F,40,0F,50,0F,60,0F,70,0F,80,0F,90,0F,A0,0F,B0,0F,C0,0F,D0,0F,E0,\n0F,F0,0E,F0,0D,F0,0C,F0,0B,F0,0A,F0,09,F0,08,F0,07,F0,06,F0,05,F0,04,F0,03,F0,02,F0,01,F0,\n00,F0,00,F1,00,F2,00,F3,00,F4,00,F5,00,F6,00,F7,00,F8,00,F9,00,FA,00,FB,00,FC,00,FD,00,FE,\n00,FF,00,EF,00,DF,00,CF,00,BF,00,AF,00,9F,00,8F,00,7F,00,6F,00,5F,00,4F,00,3F,00,2F,00,1F,\n00,0F,01,0F,02,0F,03,0F,04,0F,05,0F,06,0F,07,0F,08,0F,09,0F,0A,0F,0B,0F,0C,0F,0D,0F,0E,0F,\n0F,0F,0F,0E,0F,0D,0F,0C,0F,0B,0F,0A,0F,09,0F,08,0F,07,0F,06,0F,05,0F,04,0F,03,0F,02,0F,01")
COLOR_MODE_4 = hex_csv_to_bytes("0F,00,0F,10,0F,20,0F,30,0F,40,0F,50,0F,60,0F,70,0F,80,0F,90,0F,A0,0F,B0,0F,C0,0F,D0,0F,E0,\n0F,F0,0E,F0,0D,F0,0C,F0,0B,F0,0A,F0,09,F0,08,F0,07,F0,06,F0,05,F0,04,F0,03,F0,02,F0,01,F0,\n00,F0,00,F1,00,F2,00,F3,00,F4,00,F5,00,F6,00,F7,00,F8,00,F9,00,FA,00,FB,00,FC,00,FD,00,FE,\n00,FF,00,EF,00,DF,00,CF,00,BF,00,AF,00,9F,00,8F,00,7F,00,6F,00,5F,00,4F,00,3F,00,2F,00,1F,\n00,0F,01,0F,02,0F,03,0F,04,0F,05,0F,06,0F,07,0F,08,0F,09,0F,0A,0F,0B,0F,0C,0F,0D,0F,0E,0F,\n0F,0F,0F,0E,0F,0D,0F,0C,0F,0B,0F,0A,0F,09,0F,08,0F,07,0F,06,0F,05,0F,04,0F,03,0F,02,0F,01")
COLOR_MODE_5 = hex_csv_to_bytes("0F,00,0F,10,0F,20,0F,30,0F,40,0F,50,0F,60,0F,70,0F,80,0F,90,0F,A0,0F,B0,0F,C0,0F,D0,0F,E0,\n0F,F0,0E,F0,0D,F0,0C,F0,0B,F0,0A,F0,09,F0,08,F0,07,F0,06,F0,05,F0,04,F0,03,F0,02,F0,01,F0,\n00,F0,00,F1,00,F2,00,F3,00,F4,00,F5,00,F6,00,F7,00,F8,00,F9,00,FA,00,FB,00,FC,00,FD,00,FE,\n00,FF,00,EF,00,DF,00,CF,00,BF,00,AF,00,9F,00,8F,00,7F,00,6F,00,5F,00,4F,00,3F,00,2F,00,1F,\n00,0F,01,0F,02,0F,03,0F,04,0F,05,0F,06,0F,07,0F,08,0F,09,0F,0A,0F,0B,0F,0C,0F,0D,0F,0E,0F,\n0F,0F,0F,0E,0F,0D,0F,0C,0F,0B,0F,0A,0F,09,0F,08,0F,07,0F,06,0F,05,0F,04,0F,03,0F,02,0F,01")
COLOR_MODE_6 = hex_csv_to_bytes("0F,00,0F,10,0F,20,0F,30,0F,40,0F,50,0F,60,0F,70,0F,80,0F,90,0F,A0,0F,B0,0F,C0,0F,D0,0F,E0,\n0F,F0,0E,F0,0D,F0,0C,F0,0B,F0,0A,F0,09,F0,08,F0,07,F0,06,F0,05,F0,04,F0,03,F0,02,F0,01,F0,\n00,F0,00,F1,00,F2,00,F3,00,F4,00,F5,00,F6,00,F7,00,F8,00,F9,00,FA,00,FB,00,FC,00,FD,00,FE,\n00,FF,00,EF,00,DF,00,CF,00,BF,00,AF,00,9F,00,8F,00,7F,00,6F,00,5F,00,4F,00,3F,00,2F,00,1F,\n00,0F,01,0F,02,0F,03,0F,04,0F,05,0F,06,0F,07,0F,08,0F,09,0F,0A,0F,0B,0F,0C,0F,0D,0F,0E,0F,\n0F,0F,0F,0E,0F,0D,0F,0C,0F,0B,0F,0A,0F,09,0F,08,0F,07,0F,06,0F,05,0F,04,0F,03,0F,02,0F,01")
COLOR_MODE_7 = hex_csv_to_bytes("0F,00,0F,00,0F,00,0F,00,00,F0,00,F0,00,F0,00,F0,00,0F,00,0F,00,0F,00,0F")
COLOR_MODE_8 = hex_csv_to_bytes("0F,00,0F,00,0F,00,0F,00,00,F0,00,F0,00,F0,00,F0,00,0F,00,0F,00,0F,00,0F")
COLOR_MODE_9 = hex_csv_to_bytes("0F,00,0F,00,0F,00,\n0F,F0,0F,F0,0F,F0,\n00,F0,00,F0,00,F0,\n00,FF,00,FF,00,FF,\n00,0F,00,0F,00,0F,\n0F,0F,0F,0F,0F,0F")
COLOR_MODE_10 = hex_csv_to_bytes("0F,00,0F,00,0F,00,\n0F,F0,0F,F0,0F,F0,\n0F,F0,0F,F0,0F,F0,\n00,FF,00,FF,00,FF,\n00,0F,00,0F,00,0F,\n0F,0F,0F,0F,0F,0F")
COLOR_MODE_11 = hex_csv_to_bytes("0F,00,0F,00,0F,00,\n0F,F0,0F,F0,0F,F0,\n00,F0,00,F0,00,F0,\n00,FF,00,FF,00,FF,\n00,0F,00,0F,00,0F,\n0F,0F,0F,0F,0F,0F")
COLOR_MODE_12 = hex_csv_to_bytes("0F,00,0F,00,0F,00,\n0F,F0,0F,F0,0F,F0,\n00,F0,00,F0,00,F0,\n00,FF,00,FF,00,FF,\n00,0F,00,0F,00,0F,\n0F,0F,0F,0F,0F,0F")
COLOR_MODE_13 = hex_csv_to_bytes("0F,00,00,F0,00,0F,0F,F0,00,FF,0F,0F")
COLOR_MODE_14 = hex_csv_to_bytes("0F,00,00,0F")
COLOR_MODE_15 = hex_csv_to_bytes("0F,00,0F,00,0F,00,\n0F,F0,0F,F0,0F,F0,\n00,F0,00,F0,00,F0,\n00,FF,00,FF,00,FF,\n00,0F,00,0F,00,0F,\n0F,0F,0F,0F,0F,0F")
COLOR_MODE_16 = hex_csv_to_bytes("0F,00,0F,00,0F,00,\n0F,F0,0F,F0,0F,F0,\n00,F0,00,F0,00,F0,\n00,FF,00,FF,00,FF,\n00,0F,00,0F,00,0F,\n0F,0F,0F,0F,0F,0F")
COLOR_MODE_17 = hex_csv_to_bytes("0F,00,0F,00,0F,00,00,00,00,00,\n0F,F0,0F,F0,0F,F0,00,00,00,00,\n00,F0,00,F0,00,F0,00,00,00,00,\n00,FF,00,FF,00,FF,00,00,00,00,\n00,0F,00,0F,00,0F,00,00,00,00,\n0F,0F,0F,0F,0F,0F,00,00,00,00")
COLOR_MODE_18 = hex_csv_to_bytes("0F,00,0F,00,0F,00,00,00,00,00,\n0F,F0,0F,F0,0F,F0,00,00,00,00,\n00,F0,00,F0,00,F0,00,00,00,00,\n00,FF,00,FF,00,FF,00,00,00,00,\n00,0F,00,0F,00,0F,00,00,00,00,\n0F,0F,0F,0F,0F,0F,00,00,00,00")
COLOR_MODE_19 = hex_csv_to_bytes("0F,00,0D,00,0B,00,09,00,07,00,05,00,03,00,01,00")
COLOR_MODE_20 = hex_csv_to_bytes("01,00,03,00,05,00,07,00,09,00,0B,00,0D,00,0F,00")
COLOR_MODE_21 = hex_csv_to_bytes("00,F0,00,D0,00,B0,00,90,00,70,00,50,00,30,00,10,")
COLOR_MODE_22 = hex_csv_to_bytes("00,10,00,30,00,50,00,70,00,90,00,B0,00,D0,00,F0")
COLOR_MODE_23 = hex_csv_to_bytes("00,0F,00,0D,00,0B,00,09,00,07,00,05,00,03,00,01")
COLOR_MODE_24 = hex_csv_to_bytes("00,01,00,03,00,05,00,07,00,09,00,0B,00,0D,00,0F")
COLOR_MODE_25 = hex_csv_to_bytes("0F,F0,0D,D0,0B,B0,09,90,07,70,05,50,03,30,01,10")
COLOR_MODE_26 = hex_csv_to_bytes("01,10,03,30,05,50,07,70,09,90,0B,B0,0D,D0,0F,F0")
COLOR_MODE_27 = hex_csv_to_bytes("0F,0F,0D,0D,0B,0B,09,09,07,07,05,05,03,03,01,01")
COLOR_MODE_28 = hex_csv_to_bytes("01,01,03,03,05,05,07,07,09,09,0B,0B,0D,0D,0F,0F")
COLOR_MODE_29 = hex_csv_to_bytes("0F,00,0D,00,0B,00,09,00,07,00,05,00,03,00,01,00,\n00,F0,00,D0,00,B0,00,90,00,70,00,50,00,30,00,10,\n00,0F,00,0D,00,0B,00,09,00,07,00,05,00,03,00,01,\n0F,F0,0D,D0,0B,B0,09,90,07,70,05,50,03,30,01,10,\n00,FF,00,DD,00,BB,00,99,00,77,00,55,00,33,00,11,\n0F,0F,0D,0D,0B,0B,09,09,07,07,05,05,03,03,01,01")
COLOR_MODE_30 = hex_csv_to_bytes("01,00,03,00,05,00,07,00,09,00,0B,00,0D,00,0F,00,\n00,10,00,30,00,50,00,70,00,90,00,B0,00,D0,00,F0,\n00,01,00,03,00,05,00,07,00,09,00,0B,00,0D,00,0F,\n01,10,03,30,05,50,07,70,09,90,0B,B0,0D,D0,0F,F0,\n00,11,00,33,00,55,00,77,00,99,00,BB,00,DD,00,FF,\n01,01,03,03,05,05,07,07,09,09,0B,0B,0D,0D,0F,0F")
COLOR_MODE_31 = hex_csv_to_bytes("0F,00,00,F0,00,0F,0F,F0,00,FF,0F,0F")

# colorTypeN tables: getDataWithTextAutoColorProgramContent's autoColorType 1-14
# colour-cycle palettes (autoColorType 15-28 use a shared inline 3-colour literal,
# ported directly in programs.py rather than tabulated here).
COLOR_TYPE_1 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_2 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_3 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_4 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_5 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_6 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_7 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_8 = hex_tokens_to_bytes(["0F", "00", "0F", "F0", "00", "F0", "00", "FF", "00", "0F", "0F", "0F"])
COLOR_TYPE_9 = hex_tokens_to_bytes(["0F", "00", "0F", "F0", "00", "F0", "00", "FF", "00", "0F", "0F", "0F"])
COLOR_TYPE_10 = hex_tokens_to_bytes(["0F", "00", "0F", "F0", "00", "F0", "00", "FF", "00", "0F", "0F", "0F"])
COLOR_TYPE_11 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_12 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_13 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
COLOR_TYPE_14 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])

COLOR_TYPE = {1: COLOR_TYPE_1, 2: COLOR_TYPE_2, 3: COLOR_TYPE_3, 4: COLOR_TYPE_4, 5: COLOR_TYPE_5, 6: COLOR_TYPE_6, 7: COLOR_TYPE_7, 8: COLOR_TYPE_8, 9: COLOR_TYPE_9, 10: COLOR_TYPE_10, 11: COLOR_TYPE_11, 12: COLOR_TYPE_12, 13: COLOR_TYPE_13, 14: COLOR_TYPE_14}

# The 20 built-in frame/border colour patterns (getDataWithFrameProgramContent's
# frameType 1-20); each is a flat list of hex-token pairs in the vendor's own
# double-brace `add("0F"); add("00"); ...` list literals.
FRAME_COLORFUL_1 = hex_tokens_to_bytes(["0F", "00", "0F", "20", "0F", "40", "0F", "60", "0F", "80", "0F", "A0", "0F", "C0", "0F", "F0", "0C", "F0", "0A", "F0", "08", "F0", "06", "F0", "04", "F0", "02", "F0", "00", "F0", "00", "F2", "00", "F4", "00", "F6", "00", "F8", "00", "FA", "00", "FC", "00", "FF", "00", "CF", "00", "AF", "00", "8F", "00", "6F", "00", "4F", "00", "2F", "00", "0F", "02", "0F", "04", "0F", "06", "0F", "08", "0F", "0A", "0F", "0C", "0F", "0F", "0F", "0F", "0C", "0F", "0A", "0F", "08", "0F", "06", "0F", "04", "0F", "02", "0F", "00"])
FRAME_COLORFUL_2 = hex_tokens_to_bytes(["0F", "00", "0F", "F0", "00", "F0", "00", "FF", "00", "0F", "0F", "0F", "0F", "FF"])
FRAME_COLORFUL_3 = hex_tokens_to_bytes(["0F", "00", "00", "00", "0F", "F0", "00", "00", "00", "F0", "00", "00", "00", "FF", "00", "00", "00", "0F", "00", "00", "0F", "0F", "00", "00", "0F", "FF", "00", "00"])
FRAME_COLORFUL_4 = hex_tokens_to_bytes(["0F", "00", "0F", "00", "0F", "00", "0F", "F0", "0F", "F0", "0F", "F0", "00", "F0", "00", "F0", "00", "F0", "00", "FF", "00", "FF", "00", "FF", "00", "0F", "00", "0F", "00", "0F", "0F", "0F", "0F", "0F", "0F", "0F", "0F", "FF", "0F", "FF", "0F", "FF", "00", "00", "00", "00", "00", "00"])
FRAME_THREE_COLOR_1 = hex_tokens_to_bytes(["0F", "00", "0F", "00", "0F", "00", "0F", "00", "0F", "00", "00", "F0", "0F", "00", "0F", "00", "0F", "00", "0F", "00", "00", "0F", "0F", "00", "0F", "00", "0F", "00", "0F", "00"])
FRAME_THREE_COLOR_2 = hex_tokens_to_bytes(["0F", "00", "00", "00", "00", "F0", "00", "00", "00", "0F", "00", "00"])
FRAME_THREE_COLOR_3 = hex_tokens_to_bytes(["0F", "F0", "0F", "00", "00", "F0", "00", "F0", "00", "F0", "00", "F0", "0F", "00", "0F", "F0"])
FRAME_RED_1 = hex_tokens_to_bytes(["ff", "00"])
FRAME_RED_2 = hex_tokens_to_bytes(["ff", "00", "00", "00"])
FRAME_RED_3 = hex_tokens_to_bytes(["0F", "00", "0F", "00", "0F", "00", "0F", "00", "00", "00", "00", "00", "00", "00", "00", "00"])
FRAME_FOUR_COLOR_1 = hex_tokens_to_bytes(["0F", "FF", "0F", "FF", "0F", "FF", "0F", "FF", "0F", "FF", "0F", "F0", "0F", "F0", "0F", "F0", "0F", "F0", "0F", "F0", "0F", "0F", "0F", "0F", "0F", "0F", "0F", "0F", "0F", "0F", "00", "FF", "00", "FF", "00", "FF", "00", "FF", "00", "FF"])
FRAME_FOUR_COLOR_2 = hex_tokens_to_bytes(["0F", "FF", "0F", "FF", "0F", "FF", "00", "00", "00", "00", "0F", "F0", "0F", "F0", "0F", "F0", "00", "00", "00", "00", "0F", "0F", "0F", "0F", "0F", "0F", "00", "00", "00", "00", "00", "FF", "00", "FF", "00", "FF", "00", "00", "00", "00"])
FRAME_FOUR_COLOR_3 = hex_tokens_to_bytes(["0F", "00", "0F", "00", "0F", "00", "00", "F0", "00", "F0", "00", "F0", "00", "0F", "00", "0F", "00", "0F", "00", "00", "FF", "00", "FF", "00", "FF"])
FRAME_FOUR_COLOR_4 = hex_tokens_to_bytes(["0F", "00", "0F", "00", "0F", "00", "00", "00", "00", "00", "00", "F0", "00", "F0", "00", "F0", "00", "00", "00", "00", "00", "0F", "00", "0F", "00", "0F", "00", "00", "00", "00", "00", "FF", "00", "FF", "00", "FF", "00", "00", "00", "00"])
FRAME_GREEN_1 = hex_tokens_to_bytes(["00", "f0"])
FRAME_GREEN_2 = hex_tokens_to_bytes(["00", "f0", "00", "00"])
FRAME_GREEN_3 = hex_tokens_to_bytes(["00", "F0", "00", "F0", "00", "F0", "00", "F0", "00", "00", "00", "00", "00", "00", "00", "00"])
FRAME_YELLOW_1 = hex_tokens_to_bytes(["0f", "f0"])
FRAME_YELLOW_2 = hex_tokens_to_bytes(["0f", "f0", "00", "00"])
FRAME_YELLOW_3 = hex_tokens_to_bytes(["0f", "f0", "0f", "f0", "0f", "f0", "0F", "f0", "00", "00", "00", "00", "00", "00", "00", "00"])

# frameType 1-20, in vendor dispatch order (see getDataWithFrameProgramContent).
FRAME_TYPE = {
    1: FRAME_COLORFUL_1,
    2: FRAME_COLORFUL_2,
    3: FRAME_COLORFUL_3,
    4: FRAME_COLORFUL_4,
    5: FRAME_THREE_COLOR_1,
    6: FRAME_THREE_COLOR_2,
    7: FRAME_THREE_COLOR_3,
    8: FRAME_RED_1,
    9: FRAME_RED_2,
    10: FRAME_RED_3,
    11: FRAME_FOUR_COLOR_1,
    12: FRAME_FOUR_COLOR_2,
    13: FRAME_FOUR_COLOR_3,
    14: FRAME_FOUR_COLOR_4,
    15: FRAME_GREEN_1,
    16: FRAME_GREEN_2,
    17: FRAME_GREEN_3,
    18: FRAME_YELLOW_1,
    19: FRAME_YELLOW_2,
    20: FRAME_YELLOW_3,
}
